const https = require('https')
const fs = require('fs')
const child = require('child_process')
const homeUrl = "https://raw.githubusercontent.com/ALU52/DRA_bot/master/"
const exc = ["config.json", "app.log", "node_modules", "accounts.json", ".git", ".github"]//these files are not allowed to be overwritten during updates
const files = fs.readdirSync("./").filter(f => !exc.includes(f)).filter(f => !f.includes(".bak"))//only collect files that should be checked

let needsRestart = false;
var bot;//child process needs to be global

/*
You were fooled if you thought this file contains most of the code...

This file is responsible for setting up the bot environment, and applying updates to it.
manifest.json plays a big part in this, allowing the config to be verified, and restored if needed.
future versions will generate a config file, instead of downloading the one from GitHub - that version will get the boot.
manifest.files is mostly used for updates with new files, otherwise it doesn't really do anything.
manifest.config is what does most of the work, it shows how the config structure should look. 
^ Default values are only used when the wrong data type is there, or while generating a new config.
*/

if (!fs.existsSync("./accounts.json")) fs.writeFileSync("./accounts.json", "[]")

log('WARN', "Cold start detected")
checkForRepair()//checks files before proceeding
checkUpdates()//checks at startup
let updater = setInterval(() => {
    checkForRepair()
    checkUpdates()//save the async stuff for last
}, 600000);// (3.6e+6)

setTimeout(() => {//gives it a chance to update before starting
    bot = child.fork("./bot.js")
    bot.on('disconnect', () => {
        if (needsRestart) return; //ignore if its restarting
        log('WARN', "The bot unexpectedly closed! Stopping parent too...")
        clearInterval(updater)
    })
    bot.on('error', (err) => {
        log('ERR', `Seems like the bot has crashed. ${err.name}: ${err.message}: ${err.stack}`)
    })
}, 3000);

function checkUpdates() {
    //first check existing files
    needsRestart = false;
    files.forEach(f => {//for each file not on the ignore list
        if (fs.statSync(`./${f}`).isDirectory()) {//ignores directories
            return;
        }
        try {//backup the file first
            fs.copyFileSync(`./${f}`, `./${f}.bak`)
        } catch (error) {
            log("ERR", `Error during backup of ${f} - ${error}`)
            return;
        }
        let data = "";
        https.get(homeUrl + f, (res) => {//request the file from github
            res.on('data', chunk => data += chunk)
            res.on('end', () => {
                if (data == "404: Not Found") {//file not stored on github, ignore it
                    fs.unlinkSync(`./${f}.bak`)//delete the backup
                    return;
                } else {//file found on github
                    var file = fs.readFileSync(`./${f}`)
                    if (file == data) {//its the exact same thing, ignore it
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
                        log('WARN', "The bot unexpectedly closed! Stopping parent too...")
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

/**
 * Checks the files and settings, and repairs them if needed. Uses the manifest to do this
 */
function checkForRepair() {
    let config;
    if (!fs.existsSync("./config.json")) {
        config = {}
    } else {
        config = require('./config.json');//load the current config
    }
    https.get(homeUrl + "manifest.json", (res) => {//request the file from github
        let mData = ""
        res.on('data', chunk => mData += chunk)
        res.on('error', (err) => {
            log('ERR', `Error while fetching manifest: ${err.message}`)
        })
        res.on('end', () => {
            if (mData == "404: Not Found") {//file not stored on github, ignore it
                log('WARN', "The manifest isn't on GitHub!")
            } else {
                //after fetching manifest
                let manifest = JSON.parse(mData)//JSON.parse(mdata) - switch to require() for debugging
                //then check the manifest
                if (!manifest) { log('ERR', "Failed to parse manifest data!"); return; };
                if (manifest.files) {
                    manifest.files.forEach(f => {//see if it needs to download any files
                        let dData = "";
                        if (!fs.existsSync(`./${f}`)) {//if its not already there
                            log('INFO', `Found ${f} on the manifest - Downloading...`);
                            https.get(homeUrl + f, (res) => {//request the file from github
                                res.on('data', chunk => dData += chunk);
                                res.on('error', (err) => {
                                    log('ERR', `Error while downloading: ${err.message}`);
                                })
                                res.on('end', () => {
                                    if (dData == "404: Not Found") {//file not stored on github, ignore it
                                        log('ERR', `${f} was found on the manifest, but seems to be missing from GitHub!`);
                                        return;
                                    }
                                    fs.writeFileSync(`./${f}`, dData);
                                    log('INFO', "Done");
                                })
                            })
                        }
                    })
                }
                if (manifest.config) {//checks the config integrity
                    let confNew = manifest.config;
                    let confNewNames = Object.getOwnPropertyNames(confNew)
                    confNewNames.forEach(n => {
                        if (config[n]) {//if the setting is already there
                            if (typeof config[n] != confNew[n].type) {//only proceed if the data type is wrong
                                log('WARN', `Incorrect data type found for ${n} - restoring default`)
                                config[n] = confNew[n].default
                            }
                        } else {//missing setting, add it
                            log('INFO', `Adding new setting: ${n}`)
                            config[n] = confNew[n].default
                        }
                    })
                }
            }
        })
    })
    fs.writeFileSync("./config.json", JSON.stringify(config))
}

let conFail = 0;
process.on('uncaughtException', (err) => {
    if (err.code == "ENOTFOUND" && conFail <= 10) { conFail++; return; }//only starts logging failed connections after the 10th occurrence
    log('ERR', `Uncaught exception for the parent. ${err.name}: ${err.message}: ${err.stack}`)
})