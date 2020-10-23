const Discord = require("discord.js");
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');//for gateway
let config = require("./config.json");
let accounts = require("./accounts.json");
var waitList = new Set();

const client = new Discord.Client();
const colors = { "success": 8311585, "error": 15609652, "warning": "#f0d000" };
const emojis = { "check": "✅", "cross": "❌", "warning": "⚠️" }
var rateLimitMode = false;

config.lastBoot = Date.now();

/*
There seems to be a memory leak somewhere in here - Ive narrowed it down to the queue
Make custom objects for the queue, so unended things are filtered out
*/


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
const embedHelp = {
    "embed": {
        "title": "Help",
        "description": `${emojis.cross} Please slow down!`,
        "color": config.defaultColor,
    }
};

const embedSlowDown = {
    "embed": {
        "title": "Help",
        "description": "My job is to integrate this server with the Gw2 API\n**Commands:**\n\`\`\`\n> Help\n> Ping\n> Link\n> Unlink\n> Stats\n> GuildList\`\`\`\n**Admin commands:**\n\`\`\`\n> roleAdd\n> roleRemove\n> roles\`\`\`",
        "color": colors.error,
    }
}

const embedSettings = {
    "embed": {
        "title": "Settings",
        "description": `Usage: set <setting> <value?>\`\`\`md
- "unregisteredRole" => a role ID given to unregistered users
\`\`\`        
        `,
        "color": config.defaultColor
    }
}

const embedLinkGuide = {
    "embed": {
        "title": "Setup guide",
        "description": "Here's how to link your account:\`\`\`md\n1. Go to https://account.arena.net/applications\n2. How you manage your keys is up to you, but I need to see which guilds you're in for this to work\n3. Copy the API key you'd like to use, and paste it here\`\`\`\nIf you've changed your mind, you can ignore this message or say 'cancel'",
        "color": config.defaultColor
    }
};
//#endregion

//update embed colors with the colors object

//a bug caused accounts.json to be wiped... look into this

//#region Message handler
client.on("message", (msg) => {
    if (msg.mentions.has(client.user, { 'ignoreDirect': false, 'ignoreEveryone': true, 'ignoreRoles': true })) {//when it's mentioned
        msg.channel.send({
            "embed": {
                "description": "👋 Hey there! My prefix is `" + config.prefix + "` Use `" + config.prefix + "help` to see a list of commands",
                "color": config.defaultColor
            }
        });
    };
    if (waitList.has(msg.author.id)) { handleWaitResponse(msg.author, msg.content); return };
    //ignores bots, DMs, people on blacklist, and anything not starting with the prefix
    if (msg.author.bot || !msg.content.startsWith(config.prefix) || config.blacklist.includes(msg.author.id)) return;
    let messageArray = msg.content.split(" ");
    let command = messageArray[0].substring(config.prefix.length).toLowerCase();
    const args = messageArray.slice(1);

    switch (command) {
        case "help":
            msg.channel.send(embedHelp);
            break;

        case "ping":
            msg.reply(`Pong!\nResponse time: ${client.ws.ping} ms`);
            break;

        case "info":
            //gather up the stats
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
                    "color": config.defaultColor,
                }
            });
            break;

        case "link":
            if (accounts.find(a => a.id == msg.author.id)) { msg.reply("your account is already linked!"); break; }//if its already there
            else {
                if (msg.channel.type != 'dm') msg.channel.send(`You got it, <@${msg.author.id}> !Please check your DMs`);
                msg.author.send(embedLinkGuide);
                waitList.add(msg.author.id);
            };
            break;

        case "unlink":
            let acc = accounts.findIndex(a => a.id == msg.author.id);
            if (acc != -1) {
                accounts.splice(acc);
                msg.channel.send({
                    "embed": {
                        "description": `${emojis.check} Your account was unlinked`,
                        "color": colors.success
                    }
                });
            } else {
                msg.reply("your account is not registered");
            };
            break;

        case "roleadd":
            if (msg.channel.type == "dm") { msg.reply("this command can only be used in servers"); return; };
            if (!(msg.member.permissions.has('MANAGE_GUILD' || msg.member.permissions.has('ADMINISTRATOR')))) { msg.reply("sorry, only the server staff can use this"); return; };
            if (args.length !== 3) {//show help message if args are wrong
                msg.channel.send({
                    "embed": {
                        "description": "This command links a role to a guild to be assigned automatically\n**Usage:** roleAdd <roleID> <rank> <guildTag>\nThe rank should be a number 1-9. The rank number depends on the order in the guild. 0 will be given to every member of the guild. Otherwise, they increase with the highest rank (e.g. the leader) being #1. With the exception of #0, the highest rank = the lowest #, with the lowest rank = the highest #",
                        "color": config.defaultColor
                    }
                });
                return;
            } else {
                //should search for the guild tag first
                let guild = searchGuilds(args[2]);//search for the guild
                if (!guild) { msg.reply(`I couldn't find any guilds under "${args[2]}"\nYou may have to link your account first`); return };
                let server = guild.links[msg.guild.id];//find or create the server under the guild
                if (!server) { guild.links[msg.guild.id] = []; server = guild.links[msg.guild.id]; };//create a new one if it doesn't exist and assign it
                let role = msg.guild.roles.cache.find(r => r.id == args[0]);
                let rank = parseInt(args[1]);
                if (rank === NaN) { msg.reply(`use this command without arguments to see its usage`); return; };
                if (!role) { msg.reply("it looks like that role doesn't exist. Please use a role ID"); return; };
                prompt(msg.author, msg.channel, `This will link <@&${role.id}> to ${guild.name}\nContinue?`).then(r => {
                    if (r) {
                        //add the role link to the server under the guild
                        let newRole = { "rank": rank, "role": role.id };
                        server.push(newRole);
                        /////////////////////////////////////////////////
                        msg.channel.send({
                            "embed": {
                                "description": `${emojis.check} Link successful`,
                                "color": colors.success
                            }
                        });
                    } else {
                        msg.reply("action canceled");
                    }
                }).catch(() => {
                    msg.reply("action canceled");
                });
            };
            break;

        case "roleremove":
            if (msg.channel.type == "dm") { msg.reply("this command can only be used in servers"); return; };
            if (!(msg.member.permissions.has('MANAGE_GUILD' || msg.member.permissions.has('ADMINISTRATOR')))) { msg.reply("sorry, only the server staff can use this"); return; };
            if (args.length === 0) {//show help message
                msg.channel.send({
                    "embed": {
                        "description": "This command unlinks a role from a guild\nUsage: unlink <roleID>",
                        "color": config.defaultColor
                    }
                });
            } else {//looks like this part needs to be re-written too
                let role = msg.guild.roles.cache.find(r => r.id == args[0]);
                if (!role) { msg.reply("this role doesn't exist"); return; };
                let linkedGuilds = config.guilds.filter(g => g.links[msg.guild.id]);//filters out any guilds without links to this server
                if (!linkedGuilds) { msg.reply("this role isn't linked to any guilds"); return; };
                try {
                    linkedGuilds.forEach(g => {
                        let links = g.links['737353526417555506'];
                        if (!links) { return; } else {
                            let index = links.findIndex(l => l.role == role.id);
                            if (index != -1) {
                                msg.channel.send({
                                    "embed": {
                                        "description": `${emojis.check} <@&${links[index].role}> Was unlinked from ${g.name}`,
                                        "color": colors.success
                                    }
                                });
                                links.splice(index);
                            };
                        };
                    });
                } catch (error) {
                    log('ERR', `Failed to delete link to ${args[0]} : ${error}`);
                    msg.channel.send({
                        "embed": {
                            "description": `${emojis.cross} Failed to unlink this role, check 'roles', It might not exist`,
                            "color": colors.error
                        }
                    });
                };
            };
            break;

        case "roles":
            if (msg.channel.type == "dm") { msg.reply("this command can only be used in servers"); return; };
            let guilds = config.guilds.filter(g => Object.getOwnPropertyNames(g.links).includes(msg.guild.id));//find all the guilds tied to this server
            let collected = [];
            //create a list of configured roles for this server
            guilds.forEach(g => {//for each configured guild
                Object.getOwnPropertyNames(g.links).forEach(i => {//for each server under the guild
                    if (i === msg.guild.id) {//if the server matches this one
                        if (!g.links[msg.guild.id]) return;//if nothing is there
                        let links = g.links[msg.guild.id];
                        links.forEach(r => {//in case theres multiple roles tied to it
                            if (r == null) return;
                            collected.push({ "role": r.role, "rank": r.rank, "name": g.name });
                        });
                    };
                });
            });
            let linkBlock = ""//the string to build for the embed
            if (collected.length == 0) linkBlock = "```No links were found in this server```"; else {
                collected.forEach(l => {
                    if (l.rank == 0) {
                        linkBlock += `\n> ${l.name} [Everyone] => <@&${l.role}>`
                    } else {
                        linkBlock += `\n> ${l.name} [Rank: ${l.rank}] => <@&${l.role}>`
                    };
                });
            };
            msg.channel.send({//send the embed after the code block gets built
                "embed": {
                    "title": "Linked roles",
                    "description": "Guild | Rank | And the role it's linked to" + linkBlock,
                    "color": config.defaultColor,
                }
            });
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
                    "color": "#25A198"
                }
            };
            msg.channel.send(lEmbed);
            break;

        case "guildlist":
            let gList = "";
            config.guilds.forEach(g => gList += "\n- " + g.name)
            msg.channel.send({
                "embed": {
                    "title": "Registered guild list",
                    "description": "```md\n" + gList + "```",
                    "color": config.defaultColor
                }
            });
            break;

        case "guildrefresh":
            //only for the guild owner. This fetches ranks and updates the cached version
            let rupdatedRanks = 0;
            let raddedRanks = 0;
            let rreport = "";
            let link = accounts.find(a => a.id == msg.author.id);
            //builds a report so the guild owners know it worked
            if (!link) { msg.reply('you need to link your account before this can work'); return };
            //the rest is not implemented yet //////////////////
            break;

        case "guild":
            //returns a raw guild so all the data can be seen
            let g = JSON.stringify(searchGuilds(args[0]));
            msg.channel.send("```json\n" + g + "```");
            break;

        case "server":
            if (msg.channel.type == "dm") { msg.reply("this command can only be used in servers"); return; };
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

        case "set":
            //under construction
            //this command is for other server-specific settings, as stored in config
            //the webpage and web-to-bot API will be a workaround for this - to make up for its user unfriendliness
            //will allow an "unregistered" role to be automatically given to anybody who hasn't linked their account, among other things

            if (!msg.member.hasPermission('ADMINISTRATOR')) { msg.reply("sorry, only the server staff can use that."); return; };
            if (!args[0]) {//no args - show help page
                msg.channel.send(embedSettings)
                return;
            }
            switch (args[0].toLowerCase()) {
                case "unregisteredrole":
                    if (!args[1]) {//missing argument - show current setting
                        msg.channel.send({ embed: { "title": "Current setting", "description": `\`\`\`${config.serverSettings[msg.guild.id].unregisteredRole}\`\`\`` } })
                    } else {//args good
                        if (args[1] == "clear" || args[1] == "null" || args[1] == "reset") {//reset
                            config.serverSettings[msg.guild.id].unregisteredRole = null
                            msg.reply("Cleared the setting")
                            return;
                        };
                        let role = msg.guild.roles.cache.find(r => r.id == args[1])
                        if (!role) { msg.reply("it looks like that role doesn't exist"); return; };
                        prompt(msg.author, msg.channel, `This will give <@&${role.id}> to all unlinked accounts.\nProceed?`).then(r => {
                            if (r) {
                                config.serverSettings[msg.guild.id].unregisteredRole = role.id
                                msg.reply("linked successfully")
                            } else {
                                msg.reply("action canceled")
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
            msg.react('❓');
            break;
    }
})
//#endregion


//#region Tick
//queue managers

//maybe a set can solve the memory leak
/**@type {Discord.GuildMember[]} */
var roleQueue = []
var queAdder = setInterval(() => {//adds every account to the update que - looks like its ignoring offline users, not sure how to fix this
    if (roleQueue.length >= 10) return;//ignore if theres already a lot in there
    client.guilds.cache.forEach(g => {//does this instead of all members because it needs to manage their roles
        g.members.cache.filter(u => !u.user.bot).forEach(u => {//adds each user to the queue while excluding bots
            roleQueue.unshift(u)
        });
    });
}, 300000);//default is 300000 - which runs every 5 minutes

//this is to avoid making the APIs angry with me
let queueDelay = 500
var queueManager = setInterval(() => {
    if (roleQueue.length >= 1) {//only run if theres someone there
        let member = roleQueue[roleQueue.length - 1];
        let account = accounts.find(a => a.id === member.user.id);
        if (account) {//first check if they're registered
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
                        u.send({
                            "embed": {
                                "description": `${emojis.cross} Something went wrong when I checked your Gw2 account! It's likely the linked API key was deleted. To avoid spamming the API, your account was automatically unlinked.`,
                                "color": colors.error
                            }
                        });
                    });
                };
            } else {//nah, the cache is still valid
                account.guilds.forEach(g => {//for each cached guild from this account
                    let guild = config.guilds.find(cg => cg.id == g);//first find the guild in the config
                    if (guild.links[member.guild.id]) {//if the guild has a link to the server
                        guild.links[member.guild.id].forEach(l => {
                            if (!l || l == null) { roleQueue.pop(); return; };
                            if (l.rank == 0) {//automatically assign rank 0 because everybody gets them
                                if (member.roles.cache.has(l.role)) { roleQueue.pop; return; }; //ignore if they already have it
                                member.roles.add(l.role, `This user is in "${guild.name}"`).catch(e => {
                                    log('ERR', `Failed to manage ${member.id}'s roles: ${e}`);
                                });
                            };
                            //
                            // - Under construction - this next part will search for the guild ranks and assign them if needed
                            //
                        });
                    };
                });
            };
        } else {
            if (!config.serverSettings[member.guild.id]) return;
            if (config.serverSettings[member.guild.id].unregisteredRole != null) {
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

var waitCD = new Set();
//#region Functions
/**
 * @param {Discord.User} user The user
 * @param {string} content The content, hopefully key supplied
 */
function handleWaitResponse(user, content) {
    //to avoid spamming the API through this bot
    if (waitCD.has(user.id)) {
        user.send(embedSlowDown);
        waitCD.add(user.id);
        setTimeout(() => {
            waitCD.delete(user.id);
        }, 3000);
        return;
    }
    waitCD.add(user.id);
    setTimeout(() => {
        waitCD.delete(user.id);
    }, 1000);

    let txt = content.toLowerCase();
    if (txt == "cancel" || txt == "nevermind" || txt == "never mind" || txt == "stop" || txt == "no" || txt == "back" || txt == "wait no") {
        user.send({
            "embed": {
                "description": `${emojis.cross} Account link canceled`,
                "color": colors.error
            }
        });
        waitList.delete(user.id);
        return;
    }
    //this part needs to test the API key to make sure it works, and only remove them from the waitlist if it does
    //after that, assuming its valid, add it to the registration file
    let key = content.trim();
    apiFetch('tokeninfo', key).then(r => {
        if (r.text) {
            user.send({
                "embed": {
                    "description": `${emojis.cross} The API replied with:\n${r.text}`,
                    "color": colors.error
                }
            });
            return;
        }
        if (!r.permissions.includes('guilds')) { user.send("This key is missing guild permissions. Please fix this and again."); return; };
        apiFetch('account', key).then(r => {//request for user guilds
            accounts.push({ "id": user.id, "guilds": r.guilds, "time": Date.now(), "discordKey": null, "key": content });//add them to the account file
            waitList.delete(user.id);//remove them from the waitlist
            r.guilds.forEach(g => {//callback for each guild the user is in
                if (config.guilds.find(i => i.id == g)) return//ignores guilds it already knows about
                else {
                    newGuild(g, key, r.guild_leader.includes(g));//passes true to the function if they own the server
                };
            });
            //send confirmation message after its done
            log('INFO', `New link: ${user.id}`)
            user.send({
                "embed": {
                    "description": `${emojis.check} Successfully linked <@${user.id}> to ${r.name}`,
                    "color": colors.success
                }
            });
        });
    }).catch((err) => {
        log("ERR", `Failed guild setup: ${err}`)
        user.send({
            "embed": {
                "description": `${emojis.cross} There was an error during setup. Did you provide a valid API key? Please DM <@" + config.ownerID + "> if you'd like help`,
                "color": colors.error
            }
        });
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

//need to add support for guild owners of a guild already registered
//only edit stuff



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
        let newGuild = { "aliases": [], "ranks": [], "links": {} };
        if (!owner) leader = false; else leader = owner;
        apiFetch('guild/' + id, key).then(res => {//request more info about the guild, and register it
            newGuild.id = res.id;
            newGuild.name = res.name;
            newGuild.tag = res.tag;
            log('INFO', `New guild registered: ` + res.name);
            if (leader) {
                log('INFO', `Leader detected, adding ranks`);
                apiFetch(`guild/${g}/ranks`, key).then(ranks => {
                    ranks.forEach(r => {//append each rank to the guild object
                        newGuild.ranks.push({ "id": r.id, "order": r.order, "icon": r.icon });
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
* @param {("guild/"|"account"|"account/achievements"|"account/bank"|"account/dailycrafting"|"account/dungeons"|"account/dyes"|"account/finishers"|"account/gliders"|"account/home/cats"|"account/home/nodes"|"account/inventory"|"account/luck"|"account/mailcarriers"|"account/mapchests"|"account/masteries"|"account/mastery/points"|"account/materials"|"account/minis"|"account/mounts/skins"|"account/mounts/types"|"account/novelties"|"account/outfits"|"account/pvp/heroes"|"account/raids"|"tokeninfo"|"pvp/standings"|"pvp/games"|"pvp/stats"|"commerce/transactions"|"characters"|"account/worldbosses"|"account/wallet"|"account/titles"|"account/skins"|"account/recipes")} path The type of information to request
* @param {string} token The API token to use
* @returns {Promise<Object>}
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
    setTimeout(() => {//wait for cache before updating data
        client.guilds.cache.forEach(s => {
            if (!config.serverSettings[s.id]) {//if settings are missing
                config.serverSettings[s.id] = { "unregisteredRole": null };
            }
        });
    }, 5000);
});
client.on('guildCreate', (g) => {
    config.serverSettings[g.id] = { "unregisteredRole": null };//sets to empty settings
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
client.on('error', (err) => {
    log('ERR', `Uncaught exception: ${err.name}:${err.message} - ${err.stack}`);
})
process.on('uncaughtException', (err) => {
    log('ERR', `Uncaught exception: ${err.name}:${err.message} - ${err.stack}`);
})
process.on('message', (m) => {//manages communication with parent
    switch (m) {
        case "shutdown":
            log('INFO', "Starting bot shutdown...");
            clearInterval(queAdder);//stop adding users to the queue
            clearInterval(scrollInterval);//stop updating presence and change to restart message
            client.user.setPresence({ status: "dnd", activity: { name: "with system files", type: "PLAYING" }, });
            client.removeAllListeners();//stop listening for bot events
            server.removeAllListeners();//stop listening for API events
            stopBackup();//save one final time and stop writing to the files
            server.close();//close the API server
            setInterval(() => {
                if (roleQueue.length == 0) {//shutdown conditions
                    log('INFO', "Ready for shutdown");
                    process.exit(0);
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
//#endregion