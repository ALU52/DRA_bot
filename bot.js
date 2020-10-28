const Discord = require("discord.js");
const fs = require('fs');
const os = require('os');
const https = require('https');//for API requests
const http = require('http');//for website gateway - getting a certificate doesn't sound easy
let config = require("./config.json");
let accounts = require("./accounts.json");

const client = new Discord.Client();
const colors = { "success": 8311585, "error": 15609652, "warning": "#f0d000", "default": "#7289DA" };
const emojis = { "check": "✅", "cross": "❌", "warning": "⚠️", "question": "❓" }
var rateLimitMode = false;//stops the bot for a while on rate limit
var waitList = new Set();//list of people who need to give an API key to link
var waitCD = new Set();//a list of people who've recently responded to a linkGuide, enforces limit so gw API doesn't get spammed by jerks
var shutdownPending = false;//prevents new operation from being started when the bot is trying to restart

config.lastBoot = Date.now();
if (!config.ignoreList) config.ignoreList = [];

/*
There seems to be a memory leak somewhere in here - Ive narrowed it down to the queue
Make custom objects for the queue, so unended things are filtered out
*/


//need to add support for guild owners of a guild already registered
//only edit stuff
//also migrate role links from under guilds to under servers

//makes sure the server settings are up to date
setTimeout(() => {//gives it a moment for the cache
    let map = Object.getOwnPropertyNames(config.serverSettings);
    client.guilds.cache.forEach(g => {
        if (!map.includes(g.id)) {//if its not there
            log('INFO', `Adding settings for ${g.id}`);
            config.serverSettings[g.id] = { "unregisteredRole": null };//add blank settings
        };
    });
}, 1000);

//#region Embeds
class Embeds {
    /**
     * 
     * @param {string} string The embed text
     * @param {title=} title The embed title
     */
    default(string, title) {
        if (title) {
            return {
                "embed": {
                    "title": title,
                    "description": string,
                    "color": colors.default,
                }
            }
        } else {
            return {
                "embed": {
                    "description": string,
                    "color": colors.default,
                }
            }
        }
    }
    busyRestarting() {
        return {
            "embed": {
                "title": "Restart pending",
                "description": `${emojis.cross} Sorry, I cant start any more operations right now. Try again later`,
                "color": colors.error,
            }
        }
    }
    slowDown() {
        return {
            "embed": {
                "title": "Woah now",
                "description": `${emojis.cross} Please slow down!`,
                "color": colors.error,
            }
        }
    }
    help() {
        return {
            "embed": {
                "title": "Help",
                "description": "My job is to integrate this server with the Gw2 API\n**Commands:**\n\`\`\`\n> Help\n> Ping\n> Link\n> Unlink\n> Info\`\`\`\n**Admin commands:**\n\`\`\`\n> roleAdd\n> roleRemove\n> roles\`\`\`",
                "color": colors.default,
            }
        }
    }
    settings() {
        return {
            "embed": {
                "title": "Settings",
                "description": `Usage: set <setting> <value?>\`\`\`md
- "unregisteredRole" => a role ID given to unregistered users
        \`\`\`        
                `,
                "color": colors.default
            }
        }
    }
    linkGuide() {
        return {//sent to users who use the "link" command
            "embed": {
                "title": "Setup guide",
                "description": "Here's how to link your account:\`\`\`md\n1. Go to https://account.arena.net/applications\n2. How you manage your keys is up to you, but I need to see which guilds you're in for this to work\n3. Copy the API key you'd like to use, and paste it here\`\`\`\nIf you've changed your mind, you can ignore this message or say 'cancel'",
                "color": colors.default
            }
        };
    }
    success(string) {//wraps strings in a success embed message
        return {
            "embed": {
                "description": `${emojis.check} ${string}`,
                "color": colors.success
            }
        }
    }
    error(string) {//warps strings in an error embed message
        return {
            "embed": {
                "description": `${emojis.cross} ${string}`,
                "color": colors.error
            }
        }
    }
}
//#endregion

//update embed colors with the colors object

//a bug caused accounts.json to be wiped... look into this

//#region Message handler
client.on("message", (msg) => {
    if (rateLimitMode) return;
    if (msg.mentions.has(client.user, { 'ignoreDirect': false, 'ignoreEveryone': true, 'ignoreRoles': true })) {//when it's mentioned
        msg.channel.send(Embeds.prototype.default("👋 Hey there! My prefix is `" + config.prefix + "` Use `" + config.prefix + "help` to see a list of commands"));
    };
    if (waitList.has(msg.author.id) && msg.channel.type == "dm") { handleWaitResponse(msg.author, msg.content); return };
    //ignores bots, DMs, people on blacklist, and anything not starting with the prefix
    if (msg.author.bot || !msg.content.startsWith(config.prefix) || config.blacklist.includes(msg.author.id)) return;
    let messageArray = msg.content.split(" ");
    let command = messageArray[0].substring(config.prefix.length).toLowerCase();
    const args = messageArray.slice(1);

    switch (command) {
        case "help":
            msg.channel.send(Embeds.prototype.help());
            break;

        case "ping":
            msg.channel.send(Embeds.prototype.default(`Response time: ${client.ws.ping} ms`, "Pong!"))
            break;

        case "info":
            //gather up the stats
            if (msg.channel.type == "dm") { msg.channel.send(Embeds.prototype.error("This command can only be used in servers")); return; };
            let totalUsers = msg.guild.members.cache.filter((m) => m.user.bot == false);//filters out bots
            let serverCount = 0;
            totalUsers.forEach(u => {//finds the amount of unregistered users in the server
                if (accounts.find(a => a.id == u.id)) serverCount++;
            });
            msg.channel.send({
                "embed": {
                    "title": "Info",
                    "url": "https://github.com/ALU52/DRA_bot",
                    "description":
                        `**Bot stats:**\`\`\`\n[${serverCount}/${totalUsers.size}] Registered users in this server \n[${accounts.length}] Total registered users\n[${config.guilds.length}] Total registered guilds\n[${roleQueue.length}] Users in the queue\nLast restart was ${timeDifference(config.lastBoot)}\`\`\`\n**System info:**\n\`\`\`Memory usage: ${Math.round((os.totalmem() - os.freemem()) * 1e-6)}/${Math.round(os.totalmem() * 1e-6)} MB\nPlatform: ${os.type()}\nArch: ${os.arch()}\nLast system restart was ${timeDifference(Date.now() - os.uptime() * 1000)}\`\`\``,
                    "color": colors.default,
                }
            });
            break;

        case "link":
            if (shutdownPending) { msg.channel.send(Embeds.prototype.busyRestarting()); return; }
            if (accounts.find(a => a.id == msg.author.id)) { msg.channel.send(Embeds.prototype.error("Your account is already linked")); break; }//if its already there
            else {
                if (msg.channel.type != 'dm') msg.channel.send(Embeds.prototype.default(`You got it, <@${msg.author.id}>! Please check your DMs`));
                msg.author.send(Embeds.prototype.linkGuide());
                waitList.add(msg.author.id);
            };
            break;

        case "unlink":
            let acc = accounts.findIndex(a => a.id == msg.author.id);
            if (acc != -1) {
                accounts.splice(acc);
                msg.channel.send(Embeds.prototype.success("Your account was unlinked"));
            } else {
                msg.channel.send(Embeds.prototype.error("Your account is not registered"))
            };
            break;

        case "roleadd":
            if (msg.channel.type == "dm") { msg.channel.send(Embeds.prototype.error("This command can only be used in servers")); return; };
            if (!(msg.member.permissions.has('MANAGE_GUILD' || msg.member.permissions.has('ADMINISTRATOR')))) { msg.channel.send(Embeds.prototype.error("Sorry, only the server staff can use this")); return; };
            if (args.length != 3) {//show help message if args are wrong
                msg.channel.send(Embeds.prototype.default("This command links a role to a guild to be assigned automatically\n**Usage:** roleAdd <roleID> <rank> <guildTag>\nThe rank should be a number 1-9. The rank number depends on the order in the guild. 0 will be given to every member of the guild. Otherwise, they increase with the highest rank (e.g. the leader) being #1. With the exception of #0, the highest rank = the lowest #, with the lowest rank = the highest #"));
                return;
            } else {
                //should search for the guild tag first
                let guild = searchGuilds(args[2]);//search for the guild
                if (!guild) { Embeds.prototype.error(`I couldn't find any guilds under "${args[2]}"\nYou may have to link your account first`); return };
                let role = msg.guild.roles.cache.find(r => r.id == args[0]);
                let rank = parseInt(args[1]);//this only supports single digits - this will need to be changed later
                if (rank === NaN) { msg.channel.send(Embeds.prototype.error(`Use this command without arguments to see its usage`)); return; };
                if (!role) { msg.channel.send(Embeds.prototype.error("It looks like that role doesn't exist")); return; };
                prompt(msg.author, msg.channel, `This will link <@&${role.id}> to ${guild.name}\nContinue?`).then(r => {
                    if (r) {
                        //add the role link to the server under the guild
                        let newRole = { "rank": rank, "role": role.id, "guild": guild.id };
                        if (!config.serverSettings[msg.guild.id].links) {//if its null and needs to be set up
                            config.serverSettings[msg.guild.id].links = [newRole]
                        } else {//already setup, push to it
                            config.serverSettings[msg.guild.id].links.push(newRole)
                        }
                        /////////////////////////////////////////////////
                        msg.channel.send(Embeds.prototype.success(`Link successful`));
                    } else {
                        msg.channel.send(Embeds.prototype.error("Action canceled"));
                    }
                }).catch(() => {
                    msg.channel.send(Embeds.prototype.error("Action canceled"));
                });
            };
            break;

        case "ignoreme":
            if (config.ignoreList.includes(msg.author.id)) {
                config.ignoreList.push(msg.author.id)
                msg.channel.send(Embeds.prototype.success("You've been added to the ignore list"))
            } else {
                config.ignoreList.splice(config.findIndex(e => e == msg.author.id))
                msg.channel.send(Embeds.prototype.success("You've been removed from the ignore list"))
            }
            break;

        case "roleremove":
            if (msg.channel.type == "dm") { msg.reply("this command can only be used in servers"); return; };
            if (!(msg.member.permissions.has('MANAGE_GUILD' || msg.member.permissions.has('ADMINISTRATOR')))) { msg.channel.send(Embeds.prototype.error("Sorry, only the server staff can use this")); return; };
            if (args.length === 0) {//show help message
                msg.channel.send(Embeds.prototype.default("This command unlinks a role from a guild\nUsage: unlink <roleID>"));
            } else {//looks like this part needs to be re-written too
                let role = msg.guild.roles.cache.find(r => r.id == args[0]);
                if (!role) { msg.channel.send(Embeds.prototype.error("This role doesn't exist")); return; };
                try {
                    let remRole = config.serverSettings[msg.guild.id].links.find(r => r.role == args[0])
                    if (!remRole) {
                        msg.channel.send(Embeds.prototype.error("This role isn't linked to any guilds"))
                        return;
                    } else {
                        let remIndex = config.serverSettings[msg.guild.id].links.findIndex(r => role == args[0])
                        msg.channel.send(Embeds.prototype.success(`<@&${remRole.role}> was unlinked`))
                        config.serverSettings[msg.guild.id].links.splice(remIndex)
                        return;
                    }
                } catch (error) {
                    log('ERR', `Failed to delete link to ${args[0]} : ${error}`);
                    msg.channel.send(Embeds.prototype.error(`Failed to unlink this role, check 'roles', It might not exist`));
                };
            };
            break;

        case "roles":
            if (msg.channel.type == "dm") { msg.channel.send(Embeds.prototype.error(`This is a server only command`)); return; };
            let collected = [];
            //create a list of configured roles for this server
            if (!config.serverSettings[msg.guild.id]) {
                msg.channel.send(Embeds.prototype.error("This server isn't registered yet! This usually means there was an error behind the scenes.\nPlease try again later"));
            };
            let links = config.serverSettings[msg.guild.id].links;
            if (links) {
                links.forEach(l => {
                    let guild = config.guilds.find(g => g.id == l.guild);
                    collected.push({ "name": guild.name, "rank": l.rank, "role": l.role });
                });
            }
            let quoteBlock = ""//the string to build for the embed
            if (collected.length == 0) quoteBlock = "```No roles are linked to guilds```"; else {
                collected.forEach(l => {
                    if (l.rank == 0) {
                        quoteBlock += `\n> ${l.name} [Everyone] => <@&${l.role}>`
                    } else {
                        quoteBlock += `\n> ${l.name} [Rank: ${l.rank}] => <@&${l.role}>`
                    };
                });
            };
            msg.channel.send(Embeds.prototype.default("Guild | Rank | And the role it's linked to" + quoteBlock, "Linked roles"));
            break;

        case "log":
            if (args[0] == "clear" && msg.author.id == config.ownerID) { fs.writeFileSync(config.logPath, `\n[INFO](${Date.now()}) - The log was cleared`); msg.react(emojis.check); return; };
            let lString;
            let lLog = fs.readFileSync(config.logPath).toString().split("\n");
            let maxLines = 80;//the absolute max lines can be printed. This will be reduced if the embed goes over the character limit
            //embed descriptions must be 2048 or fewer characters
            function generate() {
                lString = "```md"//open code block
                if (lLog.length > maxLines) {//trim
                    lLog.splice(lLog.length - maxLines, lLog.length - maxLines)
                };
                for (let i = 0; i < lLog.length; i++) {//counts backwards from the length without exceeding the max
                    if (lLog[i]) lString += "\n" + lLog[i];//skip if empty
                };
            };
            generate();
            while (lString.length >= 2045) {//changed from 2048 to 2045 to counter for the "```" after code blocks
                //copy fewer lines until its small enough to fit in an embed
                maxLines--;
                generate();
            };
            lString += "```";//close the code block
            let lEmbed = {//wrap the block in an embed
                "embed": {
                    "description": lString,
                    "color": "#25A198"//different embed to match MD colors a bit
                }
            };
            msg.channel.send(lEmbed);
            break;

        case "guildrefresh":
            if (shutdownPending) { msg.channel.send(Embeds.prototype.busyRestarting()); return; }
            //only for the guild owner. This fetches ranks and updates the cached version
            let rupdatedRanks = 0;
            let raddedRanks = 0;
            let rreport = "";
            let link = accounts.find(a => a.id == msg.author.id);
            //builds a report so the guild owners know it worked
            //the rest is not implemented yet //////////////////
            break;

        case "guild":
            //returns a raw guild so all the data can be seen
            let g = JSON.stringify(searchGuilds(args[0]));
            msg.channel.send("```json\n" + g + "```");
            break;

        case "server":
            if (msg.channel.type == "dm") { msg.channel.send(Embeds.prototype.error(`This is a server only command`)); return; };
            let s = JSON.stringify(config.serverSettings[msg.guild.id]);
            msg.channel.send("```json\n" + s + "```");
            break;

        case "time":
            if (!args[0]) { msg.reply("please supply a timestamp to translate"); return };
            let num = args[0] * 1;
            if (num == NaN) { msg.reply("the timestamp should be in milliseconds since Jan 1, 1970"); return; };
            if (num >= Date.now()) { msg.reply("this tool is for reading *past* timestamps, not the future"); return; };
            msg.reply(timeDifference(args[0]));
            break;

        case "shutdown":
            //only for emergencies
            if (msg.author.id == config.ownerID) {
                msg.react(emojis.check).then(() => process.exit(0));
            };
            break;

        case "reset":
            //only for recovering from broken updates
            if (msg.author.id == config.ownerID) {
                prompt(msg.author, msg.channel, "This will reset all guild and server data!\nContinue?").then(r => {
                    if (r) {
                        let manifest = require("./manifest.json")
                        config.guilds = manifest.config.guilds.default
                        config.serverSettings = manifest.config.serverSettings.default
                        msg.channel.send(Embeds.prototype.success("Data reset"))
                    } else {
                        msg.channel.send(Embeds.prototype.error("Action canceled"))
                    }
                })
            };
            break;

        case "set":
            //under construction
            //this command is for other server-specific settings, as stored in config
            //the webpage and web-to-bot API will be a workaround for this - to make up for its user unfriendliness
            //will allow an "unregistered" role to be automatically given to anybody who hasn't linked their account, among other things

            if (!(msg.member.permissions.has('MANAGE_GUILD' || msg.member.permissions.has('ADMINISTRATOR')))) { msg.channel.send(Embeds.prototype.error("Sorry, only the server staff can use this")); return; };
            if (!args[0]) {//no args - show help page
                msg.channel.send(Embeds.prototype.settings())
                return;
            }
            switch (args[0].toLowerCase()) {
                case "unregisteredrole":
                    if (!args[1]) {//missing argument - show current setting
                        msg.channel.send(Embeds.prototype.default(`<@&${config.serverSettings[msg.guild.id].unregisteredRole}> (${config.serverSettings[msg.guild.id].unregisteredRole})`, "Current setting"))
                    } else {//args good
                        if (args[1] == "clear" || args[1] == "null" || args[1] == "reset") {//reset
                            config.serverSettings[msg.guild.id].unregisteredRole = null
                            msg.channel.send(Embeds.prototype.success("Setting reset"))
                            return;
                        };
                        let role = msg.guild.roles.cache.find(r => r.id == args[1])
                        if (!role) { msg.reply("it looks like that role doesn't exist"); return; };
                        prompt(msg.author, msg.channel, `This will give <@&${role.id}> to all unlinked accounts.\nProceed?`).then(r => {
                            if (r) {
                                config.serverSettings[msg.guild.id].unregisteredRole = role.id
                                msg.channel.send(Embeds.prototype.success("Role linked\nSet to 'null' to undo these changes"));
                            } else {
                                msg.channel.send(Embeds.prototype.error("Action canceled"));
                            }
                        })
                    };
                    break;

                default:
                    break;
            }

            break;

        default:
            //react with a question mark to unknown commands
            msg.react(emojis.question);
            break;
    }
})
//#endregion


//#region Tick
//queue managers

//maybe a set can solve the memory leak
/**@type {Discord.GuildMember[]} */
var roleQueue = [];
var queueUsers = setInterval(() => {//adds every account to the update que - looks like its ignoring offline users, not sure how to fix this
    client.guilds.cache.forEach(s => {//also updates server settings
        if (!config.serverSettings[s.id]) {//if settings are missing
            config.serverSettings[s.id] = { "unregisteredRole": null, "links": null };
            return;
        }
        if (!config.serverSettings[s.id].unregisteredRole) {
            config.serverSettings[s.id].unregisteredRole = null
        }
        if (!config.serverSettings[s.id].links) {
            config.serverSettings[s.id].links = null
        }
    });
    //now add users to the queue to be checked and managed
    if (roleQueue.length >= 10) return;//ignore if theres already a lot in there
    client.guilds.cache.forEach(g => {//does this instead of all members because it needs to manage their roles
        g.members.fetch({ force: true }).then(members => {//the cache cant be trusted apparently
            members.forEach(mem => {
                if (!mem.user.bot) roleQueue.unshift(mem)
            })
        })
    });
}, 300000);//fetches every minute

//this is to avoid making the APIs angry with me
let queueDelay = 500
var updateRoles = setInterval(() => {
    if (roleQueue.length >= 1) {//only run if theres someone there
        let member = roleQueue[roleQueue.length - 1];
        if (!config.serverSettings[member.guild.id] || ignoreList.includes(member.user.id)) {//ignore if there aren't any settings for this server or they chose to be ignored
            roleQueue.pop();
            return;
        }
        let account = accounts.find(a => a.id == member.user.id);
        if (account) {//first check if they're registered
            if (config.serverSettings[member.guild.id].unregisteredRole != null) {//if the role is configured
                if (member.roles.cache.has(config.serverSettings[member.guild.id].unregisteredRole)) {//if they have the role
                    member.roles.remove(config.serverSettings[member.guild.id].unregisteredRole)//remove it
                }
            }
            //linked, now use the cache or update it if needed
            if ((Date.now() - account.time) > config.cacheTime) {//outdated cache - update it and run the que on this account again
                try {
                    apiFetch('account', account.key).then(r => {//copied from handlewaitresponse()
                        //I hate how volatile these responses are
                        if (!r) log('ERR', "No response from the API");
                        account.guilds = r.guilds;
                        account.time = Date.now();//update account
                        r.guilds.forEach(g => {//callback for each guild the user is in
                            if (config.guilds.find(i => i.id == g)) return;//ignores guilds it already knows about
                            else {
                                newGuild(g, account.key, r.guild_leader.includes(g));//this line makes me scream inside
                            };
                        });
                    });
                    roleQueue.unshift(roleQueue.pop());//moves it to the back of the queue, to be run again
                    return;
                } catch (err) {//unlink on uncaught error
                    //massive error scope because lots could go wrong in the part above
                    log(`ERR`, `Error while checking ${member.id}, unlinked their account. \n${err}`);
                    client.users.fetch(account.id).then(u => {//let the user know there was an error and their account has been unlinked
                        let acc = accounts.findIndex(a => a.id == member.id);
                        accounts.splice(acc);
                        u.send(Embeds.prototype.error(`${emojis.cross} Something went wrong when I checked your Gw2 account! It's likely the linked API key was deleted. To avoid spamming the API, your account was automatically unlinked.`));
                    });
                };
            } else {//nah, the cache is still valid
                if (!config.serverSettings[member.guild.id].links) { roleQueue.pop(); return; }
                config.serverSettings[member.guild.id].links.forEach(l => {
                    if (!l) return;
                    if (account.guilds.includes(l.guild) && !member.roles.cache.has(l.role)) {
                        member.roles.add(l.role);
                    };
                });
            };
        } else {
            if (config.serverSettings[member.guild.id].unregisteredRole != null) {
                if (member.roles.cache.has(config.serverSettings[member.guild.id].unregisteredRole)) { roleQueue.pop(); return; };//ignore if they already have it
                member.roles.add(config.serverSettings[member.guild.id].unregisteredRole).catch(e => {
                    log('ERR', `Failed to manage ${member.id}'s roles: ${e}`);
                })
            }
        }
        roleQueue.pop();//remove from queue after its done
    }
}, queueDelay);
//file backup
let backup = setInterval(() => {//saves the accounts to the file every 5 seconds
    fs.writeFileSync(config.accountsPath, JSON.stringify(accounts));
    fs.writeFileSync("./config.json", JSON.stringify(config));
}, 5000);
function stopBackup() {
    clearInterval(backup)//stop the timer
    fs.writeFileSync(config.accountsPath, JSON.stringify(accounts));//save one final time
    fs.writeFileSync("./config.json", JSON.stringify(config));
};

//#endregion

//login after defining the events
if (!config) { log('ERR', "The bot just tried to start without a config file!"); process.exit(1); };
if (!config.token) { log('ERR', "Cannot login without a token!"); process.exit(1); };
client.login(config.token).catch(e => log('ERR', `Failed to login. It's probably a connection issue\n${e}`));

//#region Functions
/**
 * @param {Discord.User} user The user
 * @param {string} content The content, hopefully key supplied
 */
function handleWaitResponse(user, content) {
    //to avoid spamming the API through this bot
    if (waitCD.has(user.id)) {
        user.send(Embeds.prototype.slowDown());
        return;
    }
    waitCD.add(user.id);
    setTimeout(() => {
        waitCD.delete(user.id);
    }, 2500);

    let txt = content.toLowerCase();
    if (txt == "cancel" || txt == "nevermind" || txt == "never mind" || txt == "stop" || txt == "no" || txt == "back" || txt == "wait no") {
        user.send(Embeds.prototype.error("Account link canceled"));
        waitList.delete(user.id);
        return;
    }
    //this part needs to test the API key to make sure it works, and only remove them from the waitlist if it does
    //after that, assuming its valid, add it to the registration file
    let key = content.trim();
    apiFetch('tokeninfo', key).then(r => {
        if (r.text) {
            user.send(Embeds.prototype.error(`The API replied with:\n${r.text}`));
            return;
        }
        if (!r.permissions.includes('guilds')) { user.send("This key is missing guild permissions. Please fix this and again."); return; };
        apiFetch('account', key).then(r => {//request for user guilds
            accounts.push({ "id": user.id, "guilds": r.guilds, "time": Date.now(), "oauth": {}, "key": content });//add them to the account file
            waitList.delete(user.id);//remove them from the waitlist
            r.guilds.forEach(g => {//callback for each guild the user is in
                if (config.guilds.find(i => i.id == g)) return//ignores guilds it already knows about
                else {
                    newGuild(g, key, r.guild_leader.includes(g));//passes true to the function if they own the server
                };
            });
            //send confirmation message after its done
            log('INFO', `New link: ${user.id}`)
            user.send(Embeds.prototype.success(`Successfully linked <@${user.id}> to ${r.name}`));
        });
    }).catch((err) => {
        log("ERR", `Failed guild setup: ${err}`)
        user.send(Embeds.prototype.error(`There was an error during setup. Did you provide a valid API key? Please DM <@" + ${config.ownerID} + "> if you'd like help`));
        return;
    })
}

/**
 * Searches through the guilds and returns the closest thing found
 * @param {string} query The name or tag
 */
function searchGuilds(query) {
    let string = normalizeString(query);
    let result = null;
    config.guilds.forEach(g => {//first try the names - probably the best way to do it
        if (normalizeString(g.name).includes(string)) {
            result = g;
            return;
        }
    })
    if (!result) {
        config.guilds.forEach(g => {//next try aliases
            if (!g.aliases || g.aliases == []) return;//skip if there aren't any
            g.aliases.forEach(a => {//for each one
                if (normalizeString(a).includes(string)) {
                    result = g;
                    return;
                }
            })
        })
    }
    if (!result) {
        config.guilds.forEach(g => {//lastly, try guild tags
            if (normalizeString(g.tag).includes(string)) {
                result = g;
                return;
            }
        })
    }
    return result
}

/**
 * Saves a new guild
 * @param {string} id The guild ID to add
 * @param {string} key The API key to use
 * @param {boolean} owner Whether the user adding the guild is the owner. False by default
 */
function newGuild(id, key, owner) {
    //new function must be added that also reads the guild ranks if its the guild owner
    if (!config.guilds.find(g => g.id == id)) {//ignores if its already there
        let leader;
        let newGuild = { "aliases": [], "ranks": [] };
        if (!owner) leader = false; else leader = owner;//makes "owner" default to false
        apiFetch('guild/' + id, key).then(res => {//request more info about the guild, and register it
            newGuild.id = res.id;
            newGuild.name = res.name;
            newGuild.tag = res.tag;
            log('INFO', `New guild registered: ` + res.name);
            if (leader) {
                log('INFO', `Leader detected, adding ranks`);
                apiFetch(`guild/${id}/ranks`, key).then(res => {
                    if (!Array.isArray(res)) { log('ERR', `Got an unusual response from API while fetching ranks: ${res}`) }
                    res.forEach(r => {//append each rank to the guild object
                        newGuild.ranks.push({ "id": r.id, "order": r.order });
                    })
                }).catch(e => {
                    log('ERR', `Error while fetching ranks for ${id} : ${e}`);
                })
            }
            setTimeout(() => {//wait for ranks to fetch - ik theres better ways to do this
                config.guilds.push(newGuild);
            }, 1000);
        }).catch(e => {
            log('ERR', `Error while fetching guild data for ${id} : ${e}`);
        });
    };
    ///////
};

/**
 * Converts all characters in a string to the normal letter that best represents it
 * @param {string} string The string to process
 */
function normalizeString(string) {
    if (!string) return;
    let result = '';
    let key = Object.getOwnPropertyNames(characterMap);
    string.split('').forEach(l => {
        for (let i = 0; i < key.length; i++) {//cycles through each part of the map until it found a mach for the letter
            if (characterMap[key[i]].includes(l)) {//if that part of the map has the letter correct character in it
                result += key[i];
                return;
            }
        }
    })
    return result;
};
//#region String collections
const characterMap = {//this is probably the worst thing I've ever created // cases are separated because I'm not sure how lenient string.includes() is
    'a': ['A', 'a', 'À', 'Á', 'Â', 'Ã', 'Ä', 'Å', 'Æ', 'æ', 'ä'],
    'b': ['B', 'b', 'ß', 'ç', 'Ć', 'ć', 'Ĉ', 'ĉ', 'Ċ', 'ċ', 'Č', 'č'],
    'c': ['C', 'c', 'ç', 'Ć', 'ć', 'Ĉ', 'ĉ', 'Ċ', 'ċ', 'Č', 'č'],
    'd': ['D', 'd', 'Ď', 'ď', 'Đ', 'đ'],
    'e': ['E', 'e', 'È', 'É', 'Ê', 'Ë', 'è', 'é', 'ê', 'ë', 'Æ', "æ"],
    'f': ['F', 'f'],
    'g': ['G', 'g', 'Ĝ', 'ĝ', 'Ğ', 'ğ', 'Ġ', 'ġ', 'Ģ', 'ģ'],
    'h': ['H', 'h', 'Ĥ', 'ĥ', 'Ħ', 'ħ'],
    'i': ['I', 'i', 'Ì', 'Í', 'Î', 'Ï', 'ĳ', 'Ĳ', 'ï'],
    'j': ['J', 'j', 'ĳ', 'Ĵ', 'ĵ', 'Ĳ'],
    'k': ['K', 'k', 'Ķ', 'ķ', 'ĸ'],
    'l': ['L', 'l', 'Ĺ', 'ĺ', 'Ļ', 'ļ', 'Ľ', 'ľ', 'Ŀ', 'ŀ', 'Ł', 'ł'],
    'm': ['M', 'm'],
    'n': ['N', 'n', 'Ń', 'ń', 'Ņ', 'ņ', 'Ň', 'ň', 'ŉ', 'Ŋ', 'ŋ'],
    'o': ['O', 'o', 'Ō', 'ō', 'Ŏ', 'ŏ', 'Ő', 'ő', 'Œ', 'œ'],
    'p': ['P', 'p'],
    'q': ['Q', 'q'],
    'r': ['R', 'r', 'Ŕ', 'ŕ', 'Ŗ', 'ŗ', 'Ř', 'ř'],
    's': ['S', 's', 'Ś', 'ś', 'Ŝ', 'ŝ', 'Ş', 'ş', 'Š', 'š'],
    't': ['T', 't', 'Ţ', 'ţ', 'Ť', 'ť', 'Ŧ', 'ŧ'],
    'u': ['U', 'u', 'Ũ', 'ũ', 'Ū', 'ū', 'Ŭ', 'ŭ', 'Ů', 'ů', 'Ű', 'ű', 'Ų', 'ų'],
    'v': ['V', 'v'],
    'w': ['W', 'w', 'Ŵ', 'ŵ'],
    'x': ['X', 'x'],
    'y': ['Y', 'y', 'Ŷ', 'ŷ', 'Ÿ'],
    'z': ['Z', 'z', 'Ź', 'ź', 'Ż', 'ż', 'Ž', 'ž'],
    ' ': [' ']
};
//#endregion

/**
 * Logs an event
 * @param {("INFO"|"WARN"|"ERR")} type The event type
 * @param {*} message The event message
 */
function log(type, message) {
    let string = `[${type.toUpperCase()}](${Date.now()}) - ${message}`;
    if (!config.logPath) return;
    if (fs.existsSync(config.logPath)) {
        fs.appendFileSync(config.logPath, "\n" + string);
    } else {
        fs.writeFileSync(config.logPath, string);
    }
};

/**
* Sends a request to the API V2 and attaches a promise to it
* Documentation at https://wiki.guildwars2.com/wiki/API:Main
* @param {("guild/"|"account"|"account/achievements"|"account/bank"|"account/dailycrafting"|"account/dungeons"|"account/dyes"|"account/finishers"|"account/gliders"|"account/home/cats"|"account/home/nodes"|"account/inventory"|"account/luck"|"account/mailcarriers"|"account/mapchests"|"account/masteries"|"account/mastery/points"|"account/materials"|"account/minis"|"account/mounts/skins"|"account/mounts/types"|"account/novelties"|"account/outfits"|"account/pvp/heroes"|"account/raids"|"tokeninfo"|"pvp/standings"|"pvp/games"|"pvp/stats"|"commerce/transactions"|"characters"|"account/worldbosses"|"account/wallet"|"account/titles"|"account/skins"|"account/recipes")} path The type of information to request
* @param {string} token The API token to use
* @returns {Promise<Object>} The parsed JSON response. If a "text" property exists, it probably is an error
*/
function apiFetch(path, token) {
    return new Promise((resolve, reject) => {
        let url = "https://api.guildwars2.com/v2/" + path + `?access_token=${token}`;
        https.get(url, (res) => {
            let data = '';
            // A chunk of data has been recieved.
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.once('error', (e) => {
                reject(`${e.message} : ${e.stack}`);
            });
            res.once('close', () => {
                let parsed = JSON.parse(data.replace(/\n/g, ' '));//removes all the \n so it can be parsed
                resolve(parsed);
            });
        });
    });
};

/**
 * Returns true if the user clicked yes. Times out after 10 seconds
 * @param {Discord.User} who The user to accept a response from
 * @param {Discord.Channel} channel The place to send it
 * @param {string} text The question for the user
 * @returns {Promise<boolean>} Whether or not the user said yes. Returns false on timeout too
 */
function prompt(who, channel, text) {
    return new Promise(function (resolve) {
        let embed = { "embed": { "description": text, "color": colors.warning } }
        channel.send(embed).then(m => m.react(emojis.check)).then(m => m.message.react(emojis.cross)).then(m => {//add the reactions
            let filter = (reaction, user) => {
                return [emojis.check, emojis.cross].includes(reaction.emoji.name) && user.id === who.id;
            };
            let responded = false;
            m.message.awaitReactions(filter, { max: 1, time: 10000, errors: ['time'] }).then((collected => {//listen for a response
                let reaction = collected.first();
                if (collected.size >= 1) {
                    responded = true;
                }
                if (reaction.emoji.name === emojis.check) {//makes sure its the right reaction
                    resolve(true);
                } else {
                    resolve(false);
                }
            }))
            setTimeout(() => {
                if (!responded) {
                    resolve(false);
                }
            }, 10000);
        });
    });
};

/**
 * Converts a timestamp to an approximate human-readable string
 * Credit to fearofawhackplanet on stack overflow for this function
 * found at https://stackoverflow.com/questions/6108819/javascript-timestamp-to-relative-time
 * although, I removed the "current" argument because its pointless for the way I'll be using this
 * @param {number} previous The previous timestamp
 */
function timeDifference(previous) {
    var msPerMinute = 60 * 1000;
    var msPerHour = msPerMinute * 60;
    var msPerDay = msPerHour * 24;
    var msPerMonth = msPerDay * 30;
    var msPerYear = msPerDay * 365;

    var elapsed = Date.now() - previous;

    if (elapsed < msPerMinute) {
        return Math.round(elapsed / 1000) + ' seconds ago';
    }
    else if (elapsed < msPerHour) {
        return Math.round(elapsed / msPerMinute) + ' minutes ago';
    }
    else if (elapsed < msPerDay) {
        return Math.round(elapsed / msPerHour) + ' hours ago';
    }
    else if (elapsed < msPerMonth) {
        return 'approximately ' + Math.round(elapsed / msPerDay) + ' days ago';
    }
    else if (elapsed < msPerYear) {
        return 'approximately ' + Math.round(elapsed / msPerMonth) + ' months ago';
    }
    else {
        return 'approximately ' + Math.round(elapsed / msPerYear) + ' years ago';
    };
};
//#endregion

//#region Events
let scrollInterval;
let dataCheck
let msn = 0;
client.on("ready", () => {
    console.clear();
    setTimeout(() => {
        client.user.setPresence({ status: "idle", activity: { name: "just logged in", type: "PLAYING" } });
    }, 1000);
    log('INFO', "Logged in");
    scrollInterval = setInterval(() => {//update the message
        let scroll = [//activities to scroll through
            { status: "online", activity: { name: `"${config.prefix}"`, type: "LISTENING" } },
            { status: "online", activity: { name: `${client.users.cache.size} users`, type: "WATCHING" } },
            { status: "online", activity: { name: `with the API`, type: "PLAYING" } }
        ];
        client.user.setPresence(scroll[msn]);
        if (msn >= scroll.length - 1) msn = 0; else msn++;
    }, 135000);
    dataCheck = setTimeout(() => {//wait for cache before updating data
        client.guilds.cache.forEach(s => {
            if (!config.serverSettings[s.id]) {//if settings are missing
                config.serverSettings[s.id] = { "unregisteredRole": null, "links": null };
            }
        });
    }, 5000);
});
client.on('guildCreate', (g) => {
    config.serverSettings[g.id] = { "unregisteredRole": null, "links": null };//sets to empty settings
});
client.on('guildMemberAdd', (member) => {
    let serverSettings = config.serverSettings[member.guild.id];
    if (serverSettings.unregisteredRole != null) {//unregistered role is enabled, fetch it
        member.guild.roles.fetch(serverSettings.unregisteredRole).then(r => {//I keep forgetting that roles.fetch() is async
            if (!role) { log('ERR', `Tried to give an unregistered role, but it seems like ${role.id} doesn't exist `); return; };
            if (!member.manageable) { log('ERR', `I don't have permissions to manage${member.id} in ${member.guild.id}`); return; };
            member.roles.add(role);//so help me god if this throws errors
        });
    };
});
client.on('disconnect', () => {
    log('ERR', `I've lost connection to the Discord API!`);
})
client.on('warn', (warn) => {
    log('WARN', warn);
})
client.on('rateLimit', (data) => {
    log('WARN', `Ratelimit: ${data.route} / ${data.path} : ${data.method} - ignoring messages for a sec`)
    rateLimitMode = true;
    setTimeout(() => {
        rateLimitMode = false;
    }, 2500);
})
client.on('error', (err) => {
    log('ERR', `Uncaught exception: ${err.name}:${err.message} - ${err.stack}`);
})
process.on('uncaughtException', (err) => {
    log('ERR', `Uncaught exception: ${err.name}:${err.message} - ${err.stack}`);
})
process.on('message', (m) => {//manages communication with parent
    switch (m) {
        case "shutdown":
            log('INFO', "Cleaning up...");
            shutdownPending = true;
            clearInterval(queueUsers);//stop adding users to the queue
            clearInterval(scrollInterval);//stop updating presence and change to restart message
            client.user.setPresence({ status: "dnd", activity: { name: "with system files", type: "PLAYING" }, });
            server.removeAllListeners();//stop listening for API events
            stopBackup();//save one final time and stop writing to the files
            server.close();//close the API server
            setInterval(() => {
                if (roleQueue.length == 0 && waitList.size == 0) {//shutdown conditions
                    log('INFO', "Done - stopping bot");
                    client.removeAllListeners()
                    setTimeout(() => {
                        process.exit(0);
                    }, 1000);
                };
            }, 5000);
            setTimeout(() => {//in case it hangs or something
                log('INFO', "Shutdown timeout reached! Forcing shutdown...");
                process.exit(0);
            }, 30000);
            break;

        default:
            log('WARN', `I received a message, but I'm not sure what "${m}" means`);
            break;
    }
})
//#endregion

//#region Website gateway
//under development
const server = http.createServer((req, res) => {
    let jsonRes = {};//the response object that will always be returned
    let auth = req.headers.authorization;//used to make sure the user actually has permission for this
    let serverRegex = /\d{17,21}/;//used to recognize server specific settings
    let jsonResponse = true;//used to specify when the response is different
    try {
        if (req.method == "GET") {//used for fetching bot data
            let url = req.url.split("/");
            let server = url[1].match(serverRegex);
            if (server) {//get data from server
                if (!auth) {//no auth
                    jsonRes.code = 401;
                    jsonRes.message = "This endpoint requires authorization via Discord";
                } else {//auth provided

                }
            } else {//other requests
                switch (url[1]) {
                    case "endpoints":
                        jsonRes.message = "Discord server IDs may also be used in URLs. e.g. /767051229184131091 for info on this server. However, authentication is required for this. Documentation can be found on GitHub";
                        jsonRes.endpoints = ["/", "/endpoints", "/stats"];
                        jsonRes.code = 200;
                        break;


                    case "stats":
                        jsonRes.userCount = accounts.legnth;
                        jsonRes.guildCount = config.guilds.length;
                        jsonRes.uptime = Date.now() - config.lastBoot;
                        jsonRes.code = 200;
                        break;

                    case "consent":
                        jsonResponse = false;
                        //this needs to be updated
                        res.writeHead(302, { 'Location': consentUrl });
                        break;

                    case "":
                        jsonRes.message = "You aren't supposed to visit this url like a web page, silly";
                        jsonRes.code = 200;
                        break;

                    default:
                        jsonRes.message = "Unknown request";
                        jsonRes.code = 404;
                        break;
                };
            };
        } else if (req.method == "POST") {//used for changing settings

        } else {//unknown method - probably a bad thing
            jsonRes.message = "Method not allowed";
            jsonRes.code = 400;
        };
    } catch (error) {//let the client know if there are any errors
        jsonRes.message = error.message;
        jsonRes.code = 500;
    };
    if (jsonResponse) {
        res.statusCode = jsonRes.code;
        res.write(JSON.stringify(jsonRes));
        res.end();
    };
}).listen(8080);
server.on('error', (err) => {
    log('ERR', `Internal API: ${err.name} : ${err.message} : ${err.stack}`);
    if (err.name == "Error:listen EADDRINUSE") {
        log('WARN', "Looks like the bot is already running - shutting down...")
        process.exit(1)
    }
});
//#endregion