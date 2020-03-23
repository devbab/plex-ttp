const API_KEY = process.env.API_KEY || ""; // put your API_KEY from developer.here.com here


// where to put temporary files
const OUTDIR = "c:/temp";

const fs = require("fs");
const path = require("path");
const argv = require("minimist")(process.argv.slice(2));
const request = require("superagent");
const events = require("events");
const ev = new events.EventEmitter();
const unzipper = require("unzipper");
const etl = require("etl");
const csv = require("csvtojson");
const plex = require("./plex.js");
const exif = require("./exif.js");
const iso = require("./iso3166.js");

const usage = `
    usage node plex-place.js [-h] [-l] [-g [-f]] [-s jobId]
    -h : show this help
    -l : list places
    -g : get reverse geocoding on all files with GPS coord if not already updated in Plex. 
        -f : force the reverse geocoding for all images
        -n XX : process on X reverse geocode
    -c jobId: check that job is completed
    -s jobId: set places into Plex from jobId
    -d delete all Places from library
    --debug : to see various traces
    `;

let statProcessing = 0,
    exifProcessing = 0; // processing EXIF ongoing
let TheRGC = []; // liste des rgc a calculer

// Need to track when to end EXIF process and close DB connection
// emitted when change in exifProcessing or statProcessing 
function evHandler() {
    if (argv.debug)
        console.log(`exifProcessing ${exifProcessing} `); // eslint-disable-line no-console


    if (exifProcessing <= 0 && statProcessing <= 0) {
        exif.end();
        //console.log("TheRGC", TheRGC);
        //console.log("TheRGC length", TheRGC.length);
        runBatchGC();
    }
}


function findXmlTag(res, tag) {
    let regex = new RegExp(`(<${tag}>)([A-z0-9]+)(</${tag}>)`);
    let id = res.match(regex);
    if (id) return id[2];
    else return null;
}


function gid2Filename(gid) {
    return path.join(OUTDIR, "bgc_" + gid + ".txt");
}
/** 
 * prend le ficher TheRGC et lance le batch reversege geocoding
 */

function runBatchGC() {

    if (TheRGC.length == 0) {
        console.log("nothing to batch geocode"); // eslint-disable-line no-console
        return;
    }

    let url = ["https://batch.geocoder.ls.hereapi.com/6.2/jobs?",
        "apiKey=", API_KEY,
        "&mode=retrieveAddresses",
        "&action=run",
        "&header=true",
        "&inDelim=|",
        "&outDelim=|&outCols=city,county,district,country",
        "&outputcombined=true",
        "&language=en"
    ].join("");

    let i = 0;
    let body = "recId|prox\n" + TheRGC.map(elt => {
        return `${i++}|${elt.latlng}`;
    }).join("\n");



    request.post(url)
        .send(body)
        .set("Content-Type", "text/plain")
        //      .set('Accept', 'application/xml')
        .then(res => {
            let result = res.body.toString();

            //console.log(result);
            // extrait ReqestId
            const gid = findXmlTag(result, "RequestId");
            if (!gid) {
                console.error("No RequestId found");
                return;
            }
            console.log(); // eslint-disable-line no-console
            console.log(`${TheRGC.length} reverse geocodes sent`); // eslint-disable-line no-console
            console.log(`to check status: node plex-place.js -c ${gid} `); // eslint-disable-line no-console

            // write temp file with the request to batch geocoder
            const matching = TheRGC.map(elt => elt.ids).join("\n");
            const fileOut = gid2Filename(gid);
            fs.writeFile(fileOut, matching, (err) => {
                if (err) throw err;
            });
        })
        .catch(err => {
            console.error("Error requesting batch geocode", err.message);
        });

}

// get result of batch geocoding, match to correspondance file and add EXIF
// tag_valye : 10:country 20:region 30:city   40:  50: road
function listPlaces() {
    plex.init();
    let places = plex.scanPlacesTags();
    console.log("Places ", places); // eslint-disable-line no-console
    console.log("Number of Countries (10)", places.filter(place => place.tag_value == 10).length); // eslint-disable-line no-console
    console.log("Number of Region (20)", places.filter(place => place.tag_value == 20).length); // eslint-disable-line no-console
    console.log("Number of City (30)", places.filter(place => place.tag_value == 30).length); // eslint-disable-line no-console
    console.log("Number of Urban Area (40)", places.filter(place => place.tag_value == 40).length); // eslint-disable-line no-console
    console.log("Number of Streets/POI (50)", places.filter(place => place.tag_value == 50).length); // eslint-disable-line no-console

    plex.end();
}

// get result of batch geocoding, match to correspondance file and add EXIF
function addAddresses(gid) {
    plex.init();
    plex.scanPlacesTags();

    // now get result of batch geocoding
    let url = ["https://batch.geocoder.ls.hereapi.com/6.2/jobs/",
        gid,
        "/result?",
        "apiKey=", API_KEY
    ].join("");

    // read matching file
    const fileOut = gid2Filename(gid);

    let data = null;
    try {
        data = fs.readFileSync(fileOut, "utf8");
    } catch (err) {
        console.error(err.message);
    }

    if (!data)
        return;

    const matching = data.split("\n");

    // lit et dezippe la réponse
    // une seulle entrée ou plusieurs ? not clear in HERE batch geoding dcoument
    request.get(url)
        .pipe(unzipper.Parse())
        .pipe(etl.map(async entry => {
            const content = await entry.buffer();
            const txt = content.toString();

            let result = [],
                empty = [];
            csv({
                    noheader: false,
                    delimiter: "|"
                })
                .fromString(txt)
                .subscribe((json) => {
                    if (json.SeqNumber == "1")
                        result.push(json);
                    if (json.seqLength == "0") // no result for this entry
                        empty.push(json);
                    //console.log("json ",json);
                    //jsonObj: {"person.number":1234,"person":{"comment":"hello"}}
                })
                .on("done", () => {
                    //if (result.length > 0) console.log("reverse geocoding result", result);
                    //if (empty.length > 0) console.log("reverse geocoding empty results", empty);

                    result.forEach(rec => {
                        let country = iso.whereAlpha3(rec.country).country;

                        let addr = {
                            city: rec.city,
                            county: rec.county,
                            district: rec.district,
                            country: country
                        };
                        let mids = matching[rec.recId].split(","); // get list of mids
                        console.log(mids, addr); // eslint-disable-line no-console
                        mids.forEach(mid => {
                            plex.deletePlaceTags(mid); // delete existing tags for this image
                            plex.addPlaceTags(mid, addr); // add new tags
                            //console.log(mid, addr);
                        });

                    });

                    //mark empty answers as processed with timestamp into Plex
                    empty.forEach(rec => {
                        let mids = matching[rec.recId].split(","); // get list of mids
                        mids.forEach(mid => {
                            plex.updatePlaceImageTimestamp(mid); // delete existing tags for this image
                            //console.log(mid, addr);
                        });
                    });

                    // clean Place tags not referenced anywhere
                    plex.cleanLonePlaceTags();
                });

        }))
        .catch(err => {
            console.error("Error getting batch result", err.message);
        });
}


// check if result is available
function checkResultAvailable(gid) {

    // now get result of batch geocoding
    let url = ["https://batch.geocoder.ls.hereapi.com/6.2/jobs/",
        gid,
        "?action=status",
        "&apiKey=", API_KEY
    ].join("");

    // lit et dezippe la réponse
    // une seulle entrée ou plusieurs ? not clear in HERE batch geoding dcoument
    request.get(url)
        .then(status => {
            const result = status.body.toString();
            //console.log("status ", result);

            console.error("Status ", findXmlTag(result, "Status")); // eslint-disable-line no-console
            console.error("TotalCount ", findXmlTag(result, "TotalCount")); // eslint-disable-line no-console
            console.error("ValidCount ", findXmlTag(result, "ValidCount")); // eslint-disable-line no-console
            console.error("InvalidCount ", findXmlTag(result, "InvalidCount")); // eslint-disable-line no-console
            console.log(`\nWhen status completed: node plex-place.js -s ${gid} `); // eslint-disable-line no-console

        })
        .catch(err => {
            console.error("Error checking batch job", err.message);
        });
}


function DoMainScan() {

    plex.init();

    let recs = plex.scanPhotos();
    // eslint-disable-next-line no-console
    console.log("Total photos", recs.length, "\n");
    if (recs.length == 0)
        return;

    plex.addColumnPlaceUpdate();

    function doTheUpdate(rec) {

        //console.log("doTheUpdate ", rec.file,count,exifProcessing);
        //let ptags = plex.getPlaceTags(rec.mid);
        exifProcessing++;
        exif.getFromImage(rec.file).then(tags => {

            if (tags.pos) {
                count++;

                const latlng = tags.pos.lat + "," + tags.pos.lng;
                let elt = TheRGC.find(n => n.latlng == latlng);
                if (elt)
                    elt.ids.push(rec.mid);
                else
                    TheRGC.push({
                        latlng: latlng,
                        ids: [rec.mid],
                        file: rec.file
                    });

            } else
                plex.updatePlaceImageTimestamp(rec.mid); // updated with no position

            exifProcessing--;
            ev.emit("exif");

        }).catch(err => {
            console.log(err.message); // eslint-disable-line no-console
            exifProcessing--;
            ev.emit("exif");
        });
    }

    console.log(`${recs.length} photos under review`); // eslint-disable-line no-console
    let count = 0;
    recs.forEach(rec => {
        //console.log(rec);
        if (argv.n && count >= argv.n)
            return;
        count++;

        if (!rec.PlaceUpdateTime) rec.PlaceUpdateTime = 0;
        let datePlaceUpdate = Date.parse(rec.PlaceUpdateTime);
        if (argv.f) // force the update
            doTheUpdate(rec);
        else {
            statProcessing++;
            fs.stat(rec.file, (err, stat) => {
                statProcessing--;
                if (stat && stat.mtimeMs > datePlaceUpdate)
                    doTheUpdate(rec);
                ev.emit("stat");

            });
        }
    });

    //ready to track stat and exif messages
    ev.on("stat", evHandler);
    ev.on("exif", evHandler);
}


/******************** So what do we do with all that ?********* */
if (!API_KEY) {
    console.log("Missing credentials !"); // eslint-disable-line no-console
    console.log("1/ create credentials from https://developer.here.com"); // eslint-disable-line no-console
    console.log("2/ add API_KEY as environment variable or put it into file plex-place.js"); // eslint-disable-line no-console
    process.exit(0);
}


if (argv.h) {
    console.log(usage); // eslint-disable-line no-console
    process.exit(0);
}

if (argv.c)
    checkResultAvailable(argv.c);

if (argv.l)
    listPlaces();

if (argv.d) {
    plex.init();
    plex.deleteAllPlaceTags();
    plex.end();
}

if (argv.g)
    DoMainScan();

if (argv.s)
    addAddresses(argv.s);