let PLEXLIB = null;
//"C:/Users/chamaide/AppData/Local/Plex Media Server/Plug-in Support/Databases/com.plexapp.plugins.library.db";

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

let TheTTPTags = null; // list des tags TTP existants
let ThePlaceTags = null; // list des tags Places existants

let db = null;

function init() {
    //console.log("plex.init");
    // if not specified above, database should be there...
    if (!PLEXLIB)
        PLEXLIB = path.join(process.env.LOCALAPPDATA, "Plex Media Server/Plug-in Support/Databases/com.plexapp.plugins.library.db");

    if (!fs.existsSync(PLEXLIB)) {
        console.error(`${PLEXLIB} does not EXIST`);
        process.exit(1);
    }

    // open the database
    db = new Database(PLEXLIB, {
        //       verbose: console.log,
        fileMustExist: true
    });
}

/**
 * close connection to db
 */
function end() {
    db.close();
    //console.log("plex.end");
}


// add a column to table media_items, to store datetime of TTP update
// catch error if column alreadu exists
function addColumnTTPUpdate() {
    let sql = "ALTER TABLE media_items ADD COLUMN \"TTP_updated_at\" datetime";
    try {
        let stmt = db.prepare(sql);
        stmt.run();
    } catch (err) {} // if already exist, no pb
}


// add a column to table media_items, to store datetime of Place update
// catch error if column alreadu exists
function addColumnPlaceUpdate() {
    let sql = "ALTER TABLE media_items ADD COLUMN \"Place_updated_at\" datetime";
    try {
        let stmt = db.prepare(sql);
        stmt.run();
    } catch (err) {} // if already exist, no pb
}

/**
 * look for photo library. used to find items in this library
 * returns id(s) of photo library as comma separated string
 */
function getPhotoLibraryId() {

    let sql = "SELECT id as id,name as name, scanner as scanner FROM library_sections WHERE scanner = ?";
    let para = "Plex Photo Scanner";

    let stmt = db.prepare(sql);
    let rec = stmt.all(para);
    if (rec.length == 0) // no photo library
        return [];
    return rec.map(elt => elt.id).join(",");
}

/**
 * returns list of tags for a media_item_id
 * @param {*} file 
 * @returns [{tid,tag}]  taggings_id, tag
 */
function getTTPTags(mid) {

    let sql = `SELECT A.id as tid,B.tag as tag   FROM taggings as A, tags as B 
            WHERE B.id = ?
            AND A.tag_id = B.id
            AND B.tag_type = 0
            AND B.extra_data='TTP'`;

    let stmt = db.prepare(sql);
    let recs = stmt.all(mid);
    //console.log("taggins ", recs);

    return recs;
}


/**
 * returns list of tags for a media_item_id
 * @param {} mid mid is metadata_item_id of taggings
 * @returns [{tid,tag}]  taggings_id, tag
 */
function getPlaceTags(mid) {

    let sql = `SELECT A.id as tid,B.tag as tag,B.tag_value as tag_value  FROM taggings as A, tags as B 
            WHERE A.metadata_item_id = ?
            AND A.tag_id = B.id
            AND B.tag_type = 400`;

    let stmt = db.prepare(sql);
    let recs = stmt.all(mid);
    //console.log("taggins ", recs);

    return recs;
}



/**
 * remove all TTP tags for a specific mid
 * mid is the metadata_item_id of an image
 * @param {*} mid 
 */
function deleteTTPTags(mid) {

    let tags = getTTPTags(mid);
    if (tags.length == 0) // no tags
        return;

    let ids = tags.map(tag => tag.tid).join(",");
    //console.log("ids ", ids);

    let sql = `DELETE FROM taggings WHERE id IN (${ids})`;
    let stmt = db.prepare(sql);
    stmt.run();
}


/**
 * remove all Places tags for a specific mid
 * mid is the metadata_item_id of an image
 * remove the tagging link as other images may reference same tag
 * @param {*} mid 
 */
function deletePlaceTags(mid) {

    let tags = getPlaceTags(mid);
    if (tags.length == 0) // no tags
        return;

    let ids = tags.map(tag => tag.tid).join(",");
    //console.log("ids ", ids);

    let sql = `DELETE FROM taggings WHERE id IN (${ids})`;
    let stmt = db.prepare(sql);
    stmt.run();
}

// delete all tags related to a place
// tag with tag_type = 400
// and taggings related to them
function deleteAllPlaceTags() {

    let sql = `DELETE FROM taggings WHERE tag_id in 
    (select id from tags WHERE tag_type = 400) `;
    let stmt = db.prepare(sql);
    stmt.run();

    sql = "DELETE FROM tags WHERE tag_type = 400 ";
    stmt = db.prepare(sql);
    stmt.run();
}



/**
 *  remove all TTP Tags not referenced with taggings table
 */
function cleanLoneTTPTags() {

    // search tags not referenced
    let sql = `DELETE FROM tags 
     WHERE tag_type = 0 
     AND extra_data = 'TTP' 
     AND id NOT IN (select tag_id from taggings WHERE "index" = 0)`;

    let stmt = db.prepare(sql);
    stmt.run();
}


/**
 *  remove all Place Tags not referenced with taggings table
 */
function cleanLonePlaceTags() {
    // search tags not referenced
    let sql = `DELETE FROM tags 
     WHERE tag_type = 400 
     AND id NOT IN (select tag_id from taggings WHERE "index" IN (0,1,2,3,4) )`;

    let stmt = db.prepare(sql);
    stmt.run();
}



/**
 * returns list of TTP tags already created 
 * so as not to check each and every time
 * @return array of {id,tag}  where id is from table tags
 */
function scanTTPTags() {
    if (TheTTPTags)
        return;

    // search if tag exists in tags table
    let sql = `SELECT id,tag FROM tags 
     WHERE tag_type = 0 
     AND extra_data = 'TTP'`;
    let stmt = db.prepare(sql);
    TheTTPTags = stmt.all();
}


/**
 * returns list of TTP tags already created 
 * so as not to check each and every time
 * tag_valye : 10:country 20:region 30:city   40:  50: road
 * @return array of {id,tag,tag_value}  where id is from table tags
 */
function scanPlacesTags() {
    if (ThePlaceTags)
        return;

    // search if tag exists in tags table
    let sql = `SELECT id,tag,tag_value FROM tags 
     WHERE tag_type = 400`;
    let stmt = db.prepare(sql);
    ThePlaceTags = stmt.all();
    return ThePlaceTags;
}

/**
 * add tags to an image referenced by mid
 * assuming the tag is not already associated 
 * uses global variable TheTTPTags to check if tag exists, and modifies it when a tag is created
 * mid is metadata_item_id of image
 * @param {*} mid 
 * @param {*} tags 
 */
function addTTPTags(mid, tags) {
    //   console.log("add tags for meta_item_id ", mid, tags);

    for (let i = 0; i < tags.length; i++) {
        let tag = tags[i];

        let tid = null;
        let found = TheTTPTags.find(elt => elt.tag == tag);
        if (found) {
            //console.log (`${tag} already exists`,found);
            tid = found.id;
        } else {
            // if not exists
            const sql = "INSERT INTO tags (tag, tag_type,extra_data) VALUES (?, 0,'TTP')";
            const stmt = db.prepare(sql);
            const info = stmt.run(tag);
            tid = info.lastInsertRowid;
            TheTTPTags.push({
                id: tid,
                tag: tag
            }); // add a new entry in TheTTPTags
            //console.log("created ",tag, " as ",rid)
        }
        //console.log("tag created ", rid);

        let sql = "INSERT INTO taggings (metadata_item_id, tag_id, \"index\") VALUES (?, ?, '0')";
        let stmt = db.prepare(sql);
        stmt.run(mid, tid);
        //const rid = info.lastInsertRowid;
        //console.log("tagging created ", rid);

    }

    // update field TTP_updated_at
    const nowIso = new Date().toISOString();
    const sql = `UPDATE media_items SET TTP_updated_at = '${nowIso}' WHERE metadata_item_id = ${mid}`;
    const stmt = db.prepare(sql);
    stmt.run();
}

/**
 * add tags to an image referenced by mid
 * assuming the tag is not already associated 
 * uses global variable ThePlaceTags to check if tag exists, and modifies it when a tag is created
 * mid is metadata_item_id of image
 * 10:country 20:region 30:city   40:  50: road
 * @param {*} mid 
 * @param {object} {city,county,district,country} 
 */
function addPlaceTags(mid, addr) {
    //console.log("addPlaceTags for meta_item_id ", mid, places);

let places = { ...addr };
    const fields = [
          {
            name: "district",   // arrondissement, quartier
            taggings: 1,
            tags: 40
        },{
            name: "city",
            taggings: 3,
            tags: 30
        },
        {
            name: "county", //department
            taggings: 2,
            tags: 20
        },
        {
            name: "country",
            taggings: 0,
            tags: 10
        }
    ];


    if (places.county == places.city)
        places.county = "";

    // add city name to district to make it simpler to read
    if (places.district  && places.city)
        places.district  +=", "+ places.city;


   // if (places.country == "France")
//    console.log("place ", places);


    for (let i = 0; i < fields.length; i++) {
        let field = fields[i];
        let name = places[field.name];
        if (!name || name == "")
            continue;

        let tid = null;
        let found = ThePlaceTags.find(elt => {
            return (elt.tag == name && elt.tag_value == field.tags);
        });
        if (found) {
            tid = found.id;
        } else {
            // if not exists
            // eslint-disable-next-line no-console
            console.log("====> Adding new place ", name, field.tags);

            const sql = "INSERT INTO tags (tag, tag_type,tag_value, extra_data) VALUES (?, 400,?,'PLACE')";
            const stmt = db.prepare(sql);
            const info = stmt.run(name, field.tags);
            tid = info.lastInsertRowid;
            ThePlaceTags.push({
                id: tid,
                tag: name,
                tag_value: field.tags
            });
        }
        //console.log("tag created ", rid);

        let sql = "INSERT INTO taggings (metadata_item_id, tag_id, \"index\") VALUES (?, ?, ?)";
        //console.log("taggings sql ",sql)
        let stmt = db.prepare(sql);
        stmt.run(mid, tid, field.taggings);
        //const rid = info.lastInsertRowid;
        //console.log("tagging created ", rid);

    }

    // update field Place_updated_at
    const nowIso = new Date().toISOString();
    const sql = `UPDATE media_items SET Place_updated_at = '${nowIso}' WHERE metadata_item_id = ${mid}`;
    const stmt = db.prepare(sql);
    stmt.run();
}


// met le timestamp de l'image à la date de l'instant
function updatePlaceImageTimestamp(mid) {
    // update field Place_updated_at
    const nowIso = new Date().toISOString();
    const sql = `UPDATE media_items SET Place_updated_at = '${nowIso}' WHERE metadata_item_id = ${mid}`;
    const stmt = db.prepare(sql);
    stmt.run();
}

// scan  all media form library Photo
/**
 * 
 * @param {*} max max files to return  
 * returns {file,mid,uat}    filename, media_item_id, updated_time as date
 */
function scanPhotos(max = 0) {

    let ids = getPhotoLibraryId();
    if (!ids)
        return [];

    let sql = `SELECT B.metadata_item_id as mid,A.file as file, 
                B.TTP_updated_at as FaceUpdateTime, B.Place_updated_at as PlaceUpdateTime  
                FROM media_parts as A, media_items as B 
                WHERE A.media_item_id = B.id AND B.library_section_id in (${ids})  
                AND B.container = 'jpeg'  `;
    if (max != 0) sql += ` LIMIT ${max}`;
    let stmt = db.prepare(sql);
    let req = stmt.all();
    return req;
}


// list tags matching a regex
function listTag(tag) {

    scanTTPTags();

    if (tag == "")
        return TheTTPTags;

    //console.log("TTP tags ", TheTTPTags);
    const regex = new RegExp(tag);

    const res = TheTTPTags.filter(elt => elt.tag.match(regex));
    //console.log(res);
    return res;
}

module.exports = {
    init: init,
    end: end,
    listTag: listTag,
    scanPhotos: scanPhotos,

    addColumnTTPUpdate: addColumnTTPUpdate,
    cleanLoneTTPTags: cleanLoneTTPTags,
    addTTPTags: addTTPTags,
    deleteTTPTags: deleteTTPTags,
    scanTTPTags: scanTTPTags,

    addColumnPlaceUpdate: addColumnPlaceUpdate,
    scanPlacesTags: scanPlacesTags,
    cleanLonePlaceTags: cleanLonePlaceTags,
    getPlaceTags: getPlaceTags,
    deletePlaceTags: deletePlaceTags,
    deleteAllPlaceTags: deleteAllPlaceTags,
    addPlaceTags: addPlaceTags,
    updatePlaceImageTimestamp: updatePlaceImageTimestamp
};
