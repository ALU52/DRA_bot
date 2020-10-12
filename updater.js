const https = require('https')
const fs = require('fs')
const child = require('child_process')
const { ReactionUserManager } = require('discord.js')
const homeURL = "https://raw.githubusercontent.com/ALU52/GwA-Bot/master/"
const ignore = ["config.json", "app.log", "node_modules", "accounts.json", ".git"]
const files = fs.readdirSync("./").filter(f => !ignore.includes(f)).filter(f => !f.includes(".bak"))

//github is always right
const bot = child.fork("./app.js")
let needsRestart = false;

log('WARN', "Cold start detected")
checkUpdates()//checks at startup
let updater = setInterval(() => {
    checkUpdates()
}, 3.6e+6);//checks for updates every hour

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
                                log(`INFO`, `Update successful`)
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
        })
    })
    if (needsRestart) restart()
}

function restart() {
    log('INFO', "Looks like a restart is needed. Sending shutdown message to the bot...")
    bot.kill()//tells it to stop and waits until it exits
    bot.once('close', (c) => {//not sure if this is any different from 'exit'
        log('INFO', "Parent detected bot shutdown - starting it back up to apply updates")
        needsRestart = false;
        bot.removeAllListeners()
        bot = null;
        if (c == 0) {//makes sure its a 0 exit code so it didn't just crash
            setTimeout(() => {
                bot = child.fork("./app.js")//wait a bit and start it back up
            }, 100);
        }
    })
}

bot.on('disconnect', () => {
    if (needsRestart) return; //ignore if its restarting
    log('WARN', "The parent lost connection to the bot! Updates have been disabled.")
    clearInterval(updater)
})

bot.on('error', (err) => {
    log('ERR', `Seems like the bot has crashed. ${err.name}: ${err.message}: ${err.stack}`)
})
process.on('uncaughtException', (err) => {
    log('ERR', `Uncaught exception for the parent. ${err.name}: ${err.message}: ${err.stack}`)
})


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