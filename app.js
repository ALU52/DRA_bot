const Discord = require("discord.js");
const fs = require('fs');
const https = require('https')
let config = require("./config.json")
let accounts = require("./accounts.json");
var waitList = new Set();
/**@type {Discord.GuildMember[]} */
var roleQueue = []

const client = new Discord.Client();

//#region Embeds
var helpEmbed = {
    "embed": {
        "title": "Help",
        "description": "My job is to integrate this server with the Gw2 API\n**Commands:**\n\`\`\`\n> Help\n> Ping\n> Link\n> Unlink\n> Stats\n> GuildList\`\`\`\n**Admin commands:**\n\`\`\`\n> linkRole\n> unlinkRole\n> roleLinks\`\`\`",
        "color": config.defaultColor,
    }
}

var linkHelp = {
    "embed": {
        "title": "Role linking guide",
        "description": "Each role can be linked to a seperate role within a guild. If you'd like everybody in the guild to have that role, link it to rank 0.\n**How it works:**\nThe rank number starts from the highest position, with #1 being the Leader, and the number increases as you go down the list.\nDue to API restrictions, ranks greater than 0 require the guild owner to link their account. Otherwise, I cant see which ranks exist",
        "color": config.defaultColor,
    }
}

var setupEmbed = {
    "embed": {
        "title": "Setup guide",
        "description": "Here's how to link your account:\`\`\`md\n1. Go to https://account.arena.net/applications\n2. How you manage your keys is up to you, but I need to see which guilds you're in for this to work\n3. Copy the API key you'd like to use, and paste it here\`\`\`\nIf you've changed your mind, you can ignore this message",
        "color": config.defaultColor
    }
}
//#endregion

//#region Message handler
client.on("message", (msg) => {
    if (msg.mentions.has(client.user, { 'ignoreDirect': false, 'ignoreEveryone': true, 'ignoreRoles': true })) {//when it's mentioned
        msg.channel.send({
            "embed": {
                "description": "👋 Hey there! My prefix is `" + config.prefix + "` Use `" + config.prefix + "help` to see a list of commands",
                "color": 8311585
            }
        })
    }
    if (waitList.has(msg.author.id)) { handleWaitResponse(msg.author, msg.content); return }
    //ignores bots, DMs, people on blacklist, and anything not starting with the prefix
    if (msg.author.bot || msg.channel.type === "dm" || !msg.content.startsWith(config.prefix) || config.blacklist.includes(msg.author.id)) return;

    let messageArray = msg.content.split(" ")
    let cmd = messageArray[0].substring(config.prefix.length).toLowerCase();
    const args = messageArray.slice(1);

    switch (cmd) {
        case "help":
            msg.channel.send(helpEmbed);
            break;

        case "ping":
            msg.reply(`Pong!\nResponse time: ${client.ws.ping} ms`)
            break;

        case "stats":
            //gather up the stats
            let totalUsers = msg.guild.members.cache.filter((m) => m.user.bot == false)//filters out bots
            let serverReg = 0;
            totalUsers.forEach(u => {//finds the amount of unregistered users in the server
                if (accounts.find(a => a.id == u.id)) serverReg++
            })
            msg.channel.send({
                "embed": {
                    "title": "Registration stats",
                    "description": "\`\`\`\n" + "[" + serverReg + "/" + totalUsers.size + "] Registered users in this server \n[" + accounts.length + "] Total registered users\n[" + roleQueue.length + "] Operations in the queue\`\`\`",
                    "color": config.defaultColor,
                }
            })
            break;

        case "link":
            if (accounts.find(a => a.id == msg.author.id)) { msg.reply("your account is already linked!"); break; }//if its already there
            else {
                msg.channel.send(`You got it, <@${msg.author.id}>! Please check your DMs`)
                msg.author.send(setupEmbed)
                waitList.add(msg.author.id)
            }
            break;

        case "unlink":
            let acc = accounts.findIndex(a => a.id == msg.author.id)
            if (acc != -1) {
                accounts.splice(acc)
                msg.channel.send({
                    "embed": {
                        "description": "✅ Your account was unlinked",
                        "color": 8311585
                    }
                })
            } else {
                msg.reply("your account is not registered")
            }
            break;

        case "linkrole":
            if (!(msg.member.permissions.has('MANAGE_GUILD' || msg.member.permissions.has('ADMINISTRATOR')))) { msg.reply("sorry, only the server staff can use this"); return; }
            if (args.length !== 3) {//show help message if args are wrong
                msg.channel.send({
                    "embed": {
                        "description": "This command links a role to a guild to be assigned automatically\n**Usage:** linkRole <roleID> <rank> <guildTag>\nThe rank should be a number 1-9. The rank number depends on the order in the guild. 0 will be given to every member of the guild. Otherwise, they increase, with the highest rank being first. E.g. The leader = 1",
                        "color": 8311585
                    }
                })
                return;
            } else {
                //should search for the guild tag first
                let guild = searchGuilds(args[2])//search for the guild
                if (!guild) { msg.reply(`I couldn't find any guilds under "${args[2]}"\nYou may have to link your account first`); return }
                let server = guild.links[msg.guild.id]//find or create the server under the guild
                if (!server) { guild.links[msg.guild.id] = []; server = guild.links[msg.guild.id] }//create a new one if it doesn't exist and assign it
                let role = msg.guild.roles.cache.find(r => r.id == args[0])
                let rank = parseInt(args[1])
                if (rank === NaN) { msg.reply(`use this command without arguments to see its usage`); return; }
                if (!role) { msg.reply("it looks like that role doesn't exist. Please use a role ID"); return }
                prompt(msg.author, msg.channel, `This will link <@&${role.id}> to ${guild.name}\nContinue?`).then(r => {
                    if (r) {
                        //add the role link to the server under the guild
                        let newRole = { "rank": rank, "role": role.id }
                        server.push(newRole)
                        /////////////////////////////////////////////////
                        msg.channel.send({
                            "embed": {
                                "description": "✅ Link successful",
                                "color": 8311585
                            }
                        })
                    } else {
                        msg.reply("action canceled")
                    }
                })
            }
            break;

        case "unlinkrole":
            if (!(msg.member.permissions.has('MANAGE_GUILD' || msg.member.permissions.has('ADMINISTRATOR')))) { msg.reply("sorry, only the server staff can use this"); return; }
            if (args.length === 0) {//show help message
                msg.channel.send({
                    "embed": {
                        "description": "This command unlinks a role from a guild\nUsage: unlink <roleID>",
                        "color": 8311585
                    }
                })
            } else {
                let role = msg.guild.roles.cache.find(r => r.id == args[0])//makes sure the role exists first
                if (!role) { msg.reply("it looks like that role doesn't exist. Please use a role ID"); return }
                let guild = config.guilds.find((g) => g.links[msg.guild.id])//find the server under the guild
                if (!guild) { msg.reply("this guild is not registered to any roles"); return }//this should never happen, but just in case
                let server = guild.links[msg.guild.id]//edited for debugging - change this back to msg.guild.id//returns an array of linked roles for the guild object
                if (!server) { msg.reply("it looks like that guild isn't registered to this server, there's nothing to unlink."); return }//the guild doesn't have the server
                let index = server.findIndex(r => r.role == role.id)//find the given role
                if (index == -1) { msg.reply("this role is not linked to any guilds"); return }
                else {//linked role
                    server[index] = null;//this might not work ////////// must delete the role
                    msg.channel.send({
                        "embed": {
                            "description": "✅ " + "<@&" + role.id + "> was unlinked from " + guild.name,
                            "color": 8311585
                        }
                    })
                }
            }
            break;

        case "rolelinks":
            let guilds = config.guilds.filter(g => Object.getOwnPropertyNames(g.links).includes(msg.guild.id))//find all the guilds tied to this server
            let collected = []
            //create a list of configured roles for this server
            guilds.forEach(g => {//for each configured guild
                Object.getOwnPropertyNames(g.links).forEach(i => {//for each server under the guild
                    if (i === msg.guild.id) {//if the server matches this one
                        let links = g.links[msg.guild.id]//changed for debugging, should be server id
                        links.forEach(r => {//in case theres multiple roles tied to it
                            collected.push({ "role": r.role, "rank": r.rank, "name": g.name })
                        })
                    }
                })
            })
            let codeBlock = ""//the string to build for the embed
            collected.forEach(l => {
                codeBlock += `\n> [Rank:${l.rank}] <@&${l.role}> => ${l.name}`
            })
            if (collected.length === 0) codeBlock = "```No links were found in this server```"
            msg.channel.send({//send the embed after the code block gets built
                "embed": {
                    "title": "Linked roles",
                    "description": "Roles and the guilds they're linked to:" + codeBlock,
                    "color": config.defaultColor,
                }
            })
            break;

        case "log":
            let lstring = ""//this command is broken, it seems to crash the program, or completely skip the counting part
            let lmaxLines = 10
            let llog = fs.readFileSync(config.logPath).toString().split("\n")
            for (let i = llog.length; i > 0 && i > llog.length - lmaxLines; i--) {//counts backwards from the length without exceeding the max
                if (llog[i]) lstring += "\n" + llog[i]//skip if empty
            }
            let lembed = {
                "embed": {
                    "description": "Oldest are at the top```md" + lstring + "```",
                    "color": config.defaultColor
                }
            }
            msg.channel.send(lembed)
            break;

        case "guildlist":
            let glist = "";
            config.guilds.forEach(g => glist += "\n- " + g.name)
            msg.channel.send({
                "embed": {
                    "title": "Registered guild list",
                    "description": "```md\n" + glist + "```",
                    "color": config.defaultColor
                }
            })
            break;

        case "guildrefresh":
            //only for the guild owner. This fetches ranks and updates the cached version
            let rupdatedRanks = 0;
            let raddedRanks = 0
            let rreport = ""
            //builds a report so the guild owners know it worked
            //the rest is not implemented yet //////////////////
            break;

        default:
            //ignore unknown commands
            break;
    }
})
//#endregion


//#region Tick
//queue managers
const queAdder = setInterval(() => {//adds every account to the update que every 5 min - looks like its ignoring offline users, this will need to be patched
    console.log("Refreshing accounts")
    client.guilds.cache.forEach(g => {//does this instead of all members because it needs to manage their roles
        let users = g.members.cache.filter(u => !u.user.bot)//filters out bots
        users.forEach(u => {//adds each user to the queue
            roleQueue.push(u)
        })
    })
}, 300000);//default is 300000 - which runs every 5 minutes
//this is to avoid making the APIs angry with me
let queueDelay = 1200
const queueManager = setInterval(() => {
    //also updates the accounts
    //make sure to log failures
    if (roleQueue.length >= 1) {//only run if theres someone there
        let user = roleQueue[0]
        console.log(`Checking ${user.user.tag}`)
        let link = accounts.find(a => a.id === user.id)
        //first check if they're registered
        if (link) {
            //linked, now find which guilds they're in
            try {
                apiFetch('account', link.key).then(r => {//fetches guilds the user is in, and finds the needed roles
                    if (!r.guilds) { log('ERR', `Expected API to respond with guilds, instead got ${r}`); return; }
                    r.guilds.forEach(g => {
                        let internalGuild = config.guilds.find(i => i.id == g)//fetch the internal guild from the ID
                        if (internalGuild) {//if it exists?
                            if (Object.getOwnPropertyNames(internalGuild.links).length >= 1) {//if servers are associated with the guild


                                //NEEDS TO BE REWRITTEN
                                ////////////////////////////



                            }
                        } else {//found unregistered guild somehow, add it
                            newGuild(g, link.key)
                        }
                    })
                })
            } catch (err) {//failed to fetch guilds
                log('ERR', `Failed to fetch guilds for ${user.id}! Unlinking their account`)
                client.users.fetch(link.id).then(u => {//let the user know there was an error and their account has been unlinked
                    let acc = accounts.findIndex(a => a.id == msg.author.id)
                    accounts.splice(acc)
                    u.send({
                        "embed": {
                            "embed": {
                                "description": "❌ Something went wrong when I checked your Gw2 account! It's likely that the API key was deleted\nTo avoid spamming the API, your account was automatically unlinked",
                                "color": 15609652
                            }
                        }
                    })
                })
            }
        } else {
            console.log(`No link was found for ${user.user.tag}`)
        }
        roleQueue.splice(0)//remove from queue after its done
    }
}, queueDelay);
//file backup
setInterval(() => {//saves the accounts to the file every 5 seconds
    fs.writeFileSync(config.accountsPath, JSON.stringify(accounts))
    fs.writeFileSync("./config.json", JSON.stringify(config))
}, 5000);

//#endregion

//login after defining the events
client.login(config.token)

//#region Functions
/**
 * @param {Discord.User} user The user
 * @param {string} content The content, hopefully key supplied
 */
function handleWaitResponse(user, content) {
    //this part needs to test the API key to make sure it works, and only remove them from the waitlist if it does
    //after that, assuming its valid, add it to the registration file
    let key = content.trim()
    apiFetch('tokeninfo', key).then(r => {
        try {
            if (!r.permissions.includes('guilds')) { user.send("This key is missing guild permissions. Please fix this and again."); return; }
            waitList.delete(user.id)//remove them from the waitlist
            accounts.push({ "id": user.id, "key": content })//add them to the account file
            apiFetch('account', key).then(r => {//request for user guilds
                r.guilds.forEach(g => {//callback for each guild the user is in
                    if (config.guilds.find(i => i.id == g)) return//ignores guilds it already knows about
                    else {
                        newGuild(g, key, r.guild_leader.includes(g))//passes true to the function if they own the server
                    }
                })
            })
        } catch (err) {//catch error during setup
            log("ERR", `Failed guild setup: ${err}`)
            user.send({
                "embed": {
                    "description": "❌ There was an error during setup. Did you provide a valid API key? Please DM <@" + config.owner.id + "> if you'd like help",
                    "color": 15609652
                }
            })
            return;
        }
        //send confirmation message after its done
        console.log("New link:" + user.id)
        user.send({
            "embed": {
                "description": "✅ Your account was linked successfully",
                "color": 8311585
            }
        })
    })
}

/**
 * Searches through the guilds and returns the closest thing found
 * @param {string} query The name or tag
 */
function searchGuilds(query) {
    let string = normalizeString(query)
    let result = null
    config.guilds.forEach(g => {//first try the names - probably the best way to do it
        if (normalizeString(g.name).includes(string)) {
            result = g
            return;
        }
    })
    if (!result) {
        config.guilds.forEach(g => {//next try aliases
            if (!g.aliases || g.aliases == []) return;//skip if there aren't any
            g.aliases.forEach(a => {//for each one
                if (normalizeString(a).includes(string)) {
                    result = g
                    return;
                }
            })
        })
    }
    if (!result) {
        config.guilds.forEach(g => {//lastly, try guild tags
            if (normalizeString(g.tag).includes(string)) {
                result = g
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
        let newGuild = { "aliases": [], "ranks": [], "links": {} }
        if (!owner) leader = false; else leader = owner;
        apiFetch('guild/' + id, key).then(res => {//request more info about the guild, and register it
            newGuild.id = res.id;
            newGuild.name = res.name;
            newGuild.tag = res.tag;
            log('INFO', `New guild registered: ` + res.name)
            if (leader) {
                log('INFO', `Leader detected, adding ranks`)
                apiFetch(`guild/${g}/ranks`, key).then(ranks => {
                    ranks.forEach(r => {//append each rank to the guild object
                        newGuild.ranks.push({ "id": r.id, "order": r.order, "icon": r.icon })
                    })
                })
            }
            setTimeout(() => {//wait for ranks to fetch - ik theres better ways to do this
                config.guilds.push(newGuild)
            }, 1000);
        })
    }
    ///////
}

/**
 * Converts all characters in a string to the normal letter that best represents it
 * @param {string} string The string to process
 */
function normalizeString(string) {
    let result = ''
    let key = Object.getOwnPropertyNames(characterMap)
    string.split('').forEach(l => {
        for (let i = 0; i < key.length; i++) {//cycles through each part of the map until it found a mach for the letter
            if (characterMap[key[i]].includes(l)) {//if that part of the map has the letter correct character in it
                result += key[i]
                return;
            }
        }
    })
    return result
}

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
}

/**
 * Logs an event
 * @param {("INFO"|"WARN"|"ERR")} type The event type
 * @param {*} message The event message
 */
function log(type, message) {
    let string = `[${type.toUpperCase()}](${Date.now()}) - ${message}`
    if (fs.existsSync(config.logPath)) {
        fs.appendFileSync(config.logPath, "\n" + string)
    } else {
        fs.writeFileSync(config.logPath, string)
    }
}

/**
* Sends a request to the API V2 and attaches a promise to it
* @param {("guild/"|"account"|"account/achievements"|"account/bank"|"account/dailycrafting"|"account/dungeons"|"account/dyes"|"account/finishers"|"account/gliders"|"account/home/cats"|"account/home/nodes"|"account/inventory"|"account/luck"|"account/mailcarriers"|"account/mapchests"|"account/masteries"|"account/mastery/points"|"account/materials"|"account/minis"|"account/mounts/skins"|"account/mounts/types"|"account/novelties"|"account/outfits"|"account/pvp/heroes"|"account/raids"|"tokeninfo"|"pvp/standings"|"pvp/games"|"pvp/stats"|"commerce/transactions"|"characters"|"account/worldbosses"|"account/wallet"|"account/titles"|"account/skins"|"account/recipes")} path The type of information to request
* @param {string} token The API token to use
* @returns {Promise<Object>}
*/
function apiFetch(path, token) {
    return new Promise((resolve, reject) => {
        console.log(`Requesting /${path}`)
        let url = "https://api.guildwars2.com/v2/" + path + `?access_token=${token}`;
        https.get(url, (res) => {
            let data = '';
            // A chunk of data has been recieved.
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.once('error', (e) => {
                reject(e.message);
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
        let embed = { "embed": { "description": text, "color": "#f0a000" } }
        channel.send(embed).then(m => m.react(`✅`)).then(m => m.message.react(`❌`)).then(m => {//add the reactions
            let filter = (reaction, user) => {
                return ['✅', '❌'].includes(reaction.emoji.name) && user.id === who.id;
            };
            let responded = false;
            m.message.awaitReactions(filter, { max: 1, time: 10000, errors: ['time'] }).then((collected => {//listen for a response
                let reaction = collected.first();
                if (collected.size >= 1) {
                    responded = true;
                }
                if (reaction.emoji.name === '✅') {//makes sure its the right reaction
                    resolve(true)
                } else {
                    resolve(false)
                }
            }))
            setTimeout(() => {
                if (!responded) {
                    resolve(false)
                }
            }, 10000);
        })
    })
}
//#endregion

//#region Operation events
client.on("ready", () => {
    console.log(`${client.user.username} is ready!`);
    client.user.setActivity(`out for ${config.prefix}`, { 'type': "WATCHING" })
    log('INFO', "Logged in and ready to go")
});
client.on('disconnect', () => {
    log('ERR', `I've lost connection to the Discord API!`)
})
client.on('warn', (warn) => {
    log('WARN', warn)
})
client.on('error', (err) => {
    log('ERR', `Uncaught exception: ${err.name}:${err.message} - ${err.stack}`)
})
process.on('uncaughtException', (err) => {
    log('ERR', `Uncaught exception: ${err.name}:${err.message} - ${err.stack}`)
})
//communication with parent
process.on('message', (m) => {
    switch (m) {
        case "shutdown":
            log('INFO', "Looks like the parent wants a shutdown...")
            process.exit(0)
            break;

        default:
            log('WARN', `I received a message, but I'm not sure what "${m}" means`)
            break;
    }
})
//#endregion