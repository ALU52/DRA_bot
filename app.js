const Discord = require("discord.js");
const fs = require('fs');
const https = require('https')
let config = require("./config.json")
let accounts = require("./accounts.json");
var waitList = new Set();
/**@type {Discord.GuildMember[]} */
var roleQueue = []

const client = new Discord.Client();
const colors = { "success": 8311585, "error": 15609652, "warning": "#f0d000" }

//makes sure the server settings are up to date
setTimeout(() => {//gives it a moment for the cache
    let map = Object.getOwnPropertyNames(config.serverSettings)
    client.guilds.cache.forEach(g => {
        if (!map.includes(g.id)) {//if its not there
            log('INFO', `Adding settings for ${g.id}`)
            config.serverSettings[g.id] = { "unregisteredRole": null }//add blank settings
        }
    })
}, 1000);
client.on('guildCreate', (g) => {
    config.serverSettings[g.id] = { "unregisteredRole": null }//sets to empty settings
})
client.on('guildMemberAdd', (member) => {
    let serverSettings = config.serverSettings[member.guild.id]
    if (serverSettings.unregisteredRole != null) {//unregistered role is enabled, fetch it
        member.guild.roles.fetch(serverSettings.unregisteredRole).then(r => {//I keep forgetting that roles.fetch() is async
            if (!role) { log('ERR', `Tried to give an unregistered role, but it seems like ${role.id} doesn't exist `); return; }
            if (!member.manageable) { log('ERR', `I don't have permissions to manage${member.id} in ${member.guild.id}`); return; }
            member.roles.add(role)//so help me god if this throws errors
        })
    }
})


//#region Embeds
var helpEmbed = {
    "embed": {
        "title": "Help",
        "description": "My job is to integrate this server with the Gw2 API\n**Commands:**\n\`\`\`\n> Help\n> Ping\n> Link\n> Unlink\n> Stats\n> GuildList\`\`\`\n**Admin commands:**\n\`\`\`\n> roleAdd\n> roleRemove\n> roles\`\`\`",
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

//update embed colors with the colors object


//#region Message handler
client.on("message", (msg) => {
    if (msg.mentions.has(client.user, { 'ignoreDirect': false, 'ignoreEveryone': true, 'ignoreRoles': true })) {//when it's mentioned
        msg.channel.send({
            "embed": {
                "description": "👋 Hey there! My prefix is `" + config.prefix + "` Use `" + config.prefix + "help` to see a list of commands",
                "color": config.defaultColor
            }
        })
    }
    if (waitList.has(msg.author.id)) { handleWaitResponse(msg.author, msg.content); return }
    //ignores bots, DMs, people on blacklist, and anything not starting with the prefix
    if (msg.author.bot || !msg.content.startsWith(config.prefix) || config.blacklist.includes(msg.author.id)) return;

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
                    "description": "\`\`\`\n" + "[" + serverReg + "/" + totalUsers.size + "] Registered users in this server \n[" + accounts.length + "] Total registered users\n[" + config.guilds.length + "] Total registered guilds\n[" + roleQueue.length + "] Operations in the queue\`\`\`",
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
                        "color": colors.success
                    }
                })
            } else {
                msg.reply("your account is not registered")
            }
            break;

        case "roleadd":
            if (msg.channel.type == "dm") { msg.reply("this command can only be used in servers"); return; }
            if (!(msg.member.permissions.has('MANAGE_GUILD' || msg.member.permissions.has('ADMINISTRATOR')))) { msg.reply("sorry, only the server staff can use this"); return; }
            if (args.length !== 3) {//show help message if args are wrong
                msg.channel.send({
                    "embed": {
                        "description": "This command links a role to a guild to be assigned automatically\n**Usage:** roleAdd <roleID> <rank> <guildTag>\nThe rank should be a number 1-9. The rank number depends on the order in the guild. 0 will be given to every member of the guild. Otherwise, they increase with the highest rank (e.g. the leader) being #1. With the exception of #0, the highest rank = the lowest #, with the lowest rank = the highest #",
                        "color": config.defaultColor
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
                                "color": colors.success
                            }
                        })
                    } else {
                        msg.reply("action canceled")
                    }
                }).catch(() => {
                    msg.reply("action canceled")
                })
            }
            break;

        case "roleremove":
            if (msg.channel.type == "dm") { msg.reply("this command can only be used in servers"); return; }
            if (!(msg.member.permissions.has('MANAGE_GUILD' || msg.member.permissions.has('ADMINISTRATOR')))) { msg.reply("sorry, only the server staff can use this"); return; }
            if (args.length === 0) {//show help message
                msg.channel.send({
                    "embed": {
                        "description": "This command unlinks a role from a guild\nUsage: unlink <roleID>",
                        "color": config.defaultColor
                    }
                })
            } else {//looks like this part needs to be re-written too
                let role = msg.guild.roles.cache.find(r => r.id == args[0])
                if (!role) { msg.reply("this role doesn't exist"); return; }
                let linkedGuilds = config.guilds.filter(g => g.links[msg.guild.id])//filters out any guilds without links to this server
                if (!linkedGuilds) { msg.reply("this role isn't linked to any guilds"); return; }
                try {
                    linkedGuilds.forEach(g => {
                        let links = g.links['737353526417555506']
                        if (!links) { return; } else {
                            let index = links.findIndex(l => l.role == role.id)
                            if (index != -1) {
                                msg.channel.send({
                                    "embed": {
                                        "description": `✅ <@&${links[index].role}> Was unlinked from ${g.name}`,
                                        "color": colors.success
                                    }
                                })
                                links.splice(index)
                            }
                        }
                    })
                } catch (error) {
                    log('ERR', `Failed to delete link to ${args[0]} : ${error}`)
                    msg.channel.send({
                        "embed": {
                            "description": "❌ Failed to unlink this role, check `rolelinks`, It might not exist",
                            "color": colors.error
                        }
                    })
                }
            }
            break;

        case "roles"://this command keeps crashing the bot
            if (msg.channel.type == "dm") { msg.reply("this command can only be used in servers"); return; }
            let guilds = config.guilds.filter(g => Object.getOwnPropertyNames(g.links).includes(msg.guild.id))//find all the guilds tied to this server
            let collected = []
            //create a list of configured roles for this server
            guilds.forEach(g => {//for each configured guild
                Object.getOwnPropertyNames(g.links).forEach(i => {//for each server under the guild
                    if (i === msg.guild.id) {//if the server matches this one
                        if (!g.links[msg.guild.id]) return//if nothing is there
                        let links = g.links[msg.guild.id]
                        links.forEach(r => {//in case theres multiple roles tied to it
                            if (r == null) return
                            collected.push({ "role": r.role, "rank": r.rank, "name": g.name })
                        })
                    }
                })
            })
            let codeBlock = ""//the string to build for the embed
            if (collected.length == 0) codeBlock = "```No links were found in this server```"; else {
                collected.forEach(l => {
                    codeBlock += `\n> [Rank:${l.rank}] <@&${l.role}> => ${l.name}`
                })
            }
            msg.channel.send({//send the embed after the code block gets built
                "embed": {
                    "title": "Linked roles",
                    "description": "Roles and the guilds they're linked to:" + codeBlock,
                    "color": config.defaultColor,
                }
            })
            break;

        case "log":
            if (args[0] == "clear" && msg.author.id == config.owner.id) { fs.writeFileSync(config.logPath, `\n[INFO](${Date.now()}) - The log was cleared`); msg.react("✅"); return; }
            let lstring = ""//this command is broken, it seems to crash the program, or completely skip the counting part
            let lmaxLines = 20
            let llog = fs.readFileSync(config.logPath).toString().split("\n")
            for (let i = llog.length; i > 0 && i > llog.length - lmaxLines; i--) {//counts backwards from the length without exceeding the max
                if (llog[i]) lstring += "\n" + llog[i]//skip if empty
            }
            let lembed = {
                "embed": {
                    "description": "Newest events are at the top```md" + lstring + "```",
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
            let link = accounts.find(a => a.id == msg.author.id)
            //builds a report so the guild owners know it worked
            if (!link) { msg.reply('you need to link your account before this can work'); return }
            //the rest is not implemented yet //////////////////
            break;

        case "guild":
            //returns a raw guild so all the data can be seen
            let g = JSON.stringify(searchGuilds(args[0]))
            msg.channel.send("```json\n" + g + "```")
            break;

        case "server":
            if (msg.channel.type == "dm") { msg.reply("this command can only be used in servers"); return; }
            let s = JSON.stringify(config.serverSettings[msg.guild.id])
            msg.channel.send("```json\n" + s + "```")
            break;

        case "time":
            if (!args[0]) { msg.reply("please supply a timestamp to translate"); return }
            let num = args[0] * 1
            if (num == NaN) { msg.reply("the timestamp should be in milliseconds since Jan 1, 1970"); return; } else {
                msg.reply(timeDifference(args[0]))
            }
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
                                "color": colors.error
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
                    "color": colors.error
                }
            })
            return;
        }
        //send confirmation message after its done
        console.log("New link:" + user.id)
        user.send({
            "embed": {
                "description": "✅ Your account was linked successfully",
                "color": colors.success
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
    if (!string) return;
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
        let embed = { "embed": { "description": text, "color": colors.warning } }
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
    }
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