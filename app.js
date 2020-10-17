const https = require('https')
const fs = require('fs')
const child = require('child_process')
const homeURL = "https://raw.githubusercontent.com/ALU52/DRA_bot/master/"
const ignore = ["config.json", "app.log", "node_modules", "accounts.json", ".git"]
const files = fs.readdirSync("./").filter(f => !ignore.includes(f)).filter(f => !f.includes(".bak"))

//github is always right
let needsRestart = false;
var bot;

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
    files.forEach(f => {//for each file not on the ignore list
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
    //so much async crap in here. I just need to replace some files lol
    setTimeout(() => {//waits for everything to finish downloading or whatever
        if (needsRestart) {
            if (!bot) return;//when the bot hasn't started yet
            log('INFO', "Restart pending - Sending shutdown message to bot...")
            bot.kill()//tells it to stop and waits until it exits
            bot.once('close', () => {//not sure if this is any different from 'exit'
                log('INFO', "Parent detected bot shutdown - Restarting...")
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
