# plex-ttp
[Plex](http://plex.tv) is an amazing software to organize, stream, and share your personal multimedia collections, including photos.

[Tag That Photo](http://tagthatphoto.com), aka TTP, is an amazing software to recognise faces from your collection of photos.

Unfortunately, Plex does not recognise the XMP tags created by TTP. This script allows one to insert TTP faces recorded into the photos into Plex database.

## Warning
**The script interacts directly with Plex database.** 
Make sure you have a [backup of your database](https://support.plex.tv/articles/201539237-backing-up-plex-media-server-data/)  before using this script.
In case of any issues, [restore your database](https://support.plex.tv/articles/201539237-backing-up-plex-media-server-data/) !

## Installation

1/ assuming node.js and npm are already installed, install the package as follow:

    npm install plex-ttp

## Usage

    usage node plex-ttp.js [-s] [-h] [-l tag] [-d tag] 
    -s : scan images and put face tags into Plex
    -l [tag] : list matching tags
    -d tag: delete the tag
    -h : show this help


**node plex-ttp.js -s**   is the basic command to run to scan all photos from our Plex library, extract the tag faces and insert them into Plex. Face names are then available within the  [Tag list of Plex](http:plex_screenshot.jpg)


* * *

&copy; 2020 devbab