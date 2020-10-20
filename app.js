const https = require('https')
const fs = require('fs')
const child = require('child_process')
const homeURL = "https://raw.githubusercontent.com/ALU52/DRA_bot/master/"
const ignore = ["config.json", "app.log", "node_modules", "accounts.json", ".git"]
const files = fs.readdirSync("./").filter(f => !ignore.includes(f)).filter(f => !f.includes(".bak"))

//github is always right
let needsRestart = false;
var bot;

//push update that allows updater to download files even if they arent in the dir
//maybe github has a way to list the files in the repo

log('WARN', "Cold start detected")
checkUpdates()//checks at startup
let updater = setInterval(() => {
    checkUpdates()
}, 600000);// (3.6e+6)

setTimeout(() => {//gives it a chance to update before starting
    bot = child.fork("./bot.js")
    bot.on('disconnect', () => {
        if (needsRestart) return; //ignore if its restarting
        log('WARN', "The parent lost connection to the bot! Updates have been disabled.")
        clearInterval(updater)
    })
    bot.on('error', (err) => {
        log('ERR', `Seems like the bot has crashed. ${err.name}: ${err.message}: ${err.stack}`)
    })
}, 3000);

function checkUpdates() {
    https.get(homeURL + "manifest.json", (res) => {//request the file from github
        let mdata = ""
        res.on('data', chunk => mdata += chunk)
        res.on('error', (err) => {
            log('ERR', `Error while fetching manifest: ${err.message}`)
        })
        res.on('end', () => {
            if (mdata == "404: Not Found") {//file not stored on github, ignore it
                log('WARN', "The manifest isn't on GitHub!")
                return;//I know this isn't needed, but it makes me feel safer
            }
            //after fetching manifest
            let manifest = JSON.parse(mdata).checkList
            //first check existing files
            files.forEach(f => {//for each file not on the ignore list
                if (fs.statSync(`./${f}`).isDirectory()) {//ignores directories
                    return;
                }
                //backup the file first
                try {
                    fs.copyFileSync(`./${f}`, `./${f}.bak`)
                } catch (error) {
                    log("ERR", `Error during backup of ${f} - ${error}`)
                    return;
                }
                let data = "";
                https.get(homeURL + f, (res) => {//request the file from github
                    res.on('data', chunk => data += chunk)
                    res.on('end', () => {
                        if (data == "404: Not Found") {//file not stored on github, ignore it
                            fs.unlinkSync(`./${f}.bak`)//delete the backup
                            return;
                        } else {//file found on github
                            var file = fs.readFileSync(`./${f}`)
                            if (file == data) {//the same thing, delete backup
                                fs.unlinkSync(`./${f}.bak`)//delete the backup
                                return;
                            } else {//changes detected
                                log('INFO', `GitHub has a different version of ${f} - overwriting...`)
                                fs.writeFile(`./${f}`, data, (err) => {
                                    if (fs.statSync(`./${f}`).size > 0 && !err) {//checks for errors
                                        if (f == "app.js") log('WARN', "Changes made to app.js will not take effect until manually restarted")
                                        log(`INFO`, `Done`)
                                        needsRestart = true;
                                        fs.unlinkSync(`./${f}.bak`)
                                        return;
                                    } else {//empty file, or error, restores backup
                                        log('WARN', `${f} was "updated" to an empty file! Restoring backup...`)
                                        fs.copyFile(`./${f}.bak`, `./${f}`, (err) => {
                                            if (err) {
                                                log(`ERR`, `Couldn't restore the backup - Something has gone horribly wrong! Shutting down for safety...`)
                                                process.exit(1)
                                            } else {
                                                log('INFO', `Restoration successful`)
                                                fs.unlinkSync(`./${f}.bak`)
                                                return;
                                            }
                                        })
                                    }
                                })
                            }
                        }
                    })
                    res.on('error', (err) => {
                        log('ERR', `Error while fetching updates: ${err.message}`)
                    })
                })
            })
            //then check for files that need to be downloaded
            if (!manifest) return;
            manifest.forEach(f => {
                let ddata = "";
                if (!fs.existsSync(`./${f}`)) {//if its not already there
                    log('INFO', `Found ${f} on the manifest - Downloading...`)
                    https.get(homeURL + f, (res) => {//request the file from github
                        res.on('data', chunk => ddata += chunk)
                        res.on('error', (err) => {
                            log('ERR', `Error while downloading: ${err.message}`)
                        })
                        res.on('end', () => {
                            if (ddata == "404: Not Found") {//file not stored on github, ignore it
                                log('ERR', `${f} was found on the manifest, but seems to be missing from GitHub!`)
                                return;
                            }
                            fs.writeFileSync(`./${f}`, ddata)
                            log('INFO', "Done")
                        })
                    })
                }
            })
        })
    })
    //so much async crap in here. I just need to replace some files lol
    setTimeout(() => {//waits for everything to finish downloading or whatever
        if (needsRestart) {
            if (!bot) return;//when the bot hasn't started yet
            log('INFO', "Restart pending - Sending shutdown message to bot...")
            bot.send("shutdown")
            bot.once('close', () => {//not sure if this is any different from 'exit'
                log('INFO', "Bot closed - Restarting...")
                bot.removeAllListeners()
                bot = null;
                setTimeout(() => {
                    needsRestart = false;
                    bot = child.fork("./bot.js")//wait a bit and start it back up
                    //add listeners again
                    bot.on('disconnect', () => {
                        if (needsRestart) return; //ignore if its restarting
                        log('WARN', "The parent lost connection to the bot! Updates have been disabled.")
                        clearInterval(updater)
                    })
                    bot.on('error', (err) => {
                        log('ERR', `Seems like the bot has crashed. ${err.name}: ${err.message}: ${err.stack}`)
                    })
                }, 1000);
            })
        }
    }, 3000);
}

/**
 * Logs an event
 * @param {("INFO"|"WARN"|"ERR")} type The event type
 * @param {*} message The event message
 */
function log(type, message) {
    let string = `[${type.toUpperCase()}](${Date.now()}) - ${message}`
    if (fs.existsSync("./app.log")) {
        fs.appendFileSync("./app.log", "\n" + string)
    } else {
        fs.writeFileSync("./app.log", string)
    }
}

let conFail = 0;
process.on('uncaughtException', (err) => {
    if (err.code == "ENOTFOUND" && conFail <= 10) { conFail++; return; }//only starts logging failed connections after the 10th occurrence
    log('ERR', `Uncaught exception for the parent. ${err.name}: ${err.message}: ${err.stack}`)
})
