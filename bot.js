const Discord = require("discord.js");
const fs = require('fs');
const os = require('os');
const https = require('https');//for API requests
const http = require('http');//for website gateway - getting a certificate doesn't sound easy
let config = require("./config.json");
/**@type {Account[]} */
let accounts = require("./accounts.json");
var XMLHttpRequest = require("xhr2");
var webPush = new XMLHttpRequest();

var wordExeptions = ["crap", "ass", "damn", "hell", "god"];
var BadWords = [];
require("badwords/array").forEach(w => { if (!wordExeptions.includes(w)) BadWords.push(w) })
var wordRegex = new RegExp(BadWords.join("|"), 'gi');
const { black } = require("color-name");
const { count } = require("console");

const client = new Discord.Client();//The bot client... duhhh
const colors = { "success": 8311585, "error": 15609652, "warning": "#f0d000", "default": "#7289DA" };
const emojis = { "check": "✅", "cross": "❌", "warning": "⚠️", "question": "❓" };
var rateLimitMode = false;//stops the bot for a while on rate limit
var waitList = new Set();//list of people who need to give an API key to link
var waitCD = new Set();//a list of people who've recently responded to a linkGuide, enforces limit so gw API doesn't get spammed by jerks
var shutdownPending = false;//prevents new operation from being started when the bot is trying to restart
let manifest;//used for checking config integrity and restoring default values if needed

config.lastBoot = Date.now();
if (!config.ignoreList) config.ignoreList = [];//not sure if its safe to remove this yet

//need to add support for guild owners of a guild already registered
//so it only edits/inserts stuff

//Im going nuts with the classes because I'm trying to standardize the way data is handled. Its a fcking mess rn

//#region Classes
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
            };
        } else {
            return {
                "embed": {
                    "description": string,
                    "color": colors.default,
                }
            };
        };
    };
    /**
     * 
     * @param {Discord.User} warnedUser The user that's being warned
     */
    noProfanity(warnedUser) {
        return {
            "embed": {
                "title": "Oops!",
                "description": `${emojis.cross} Please don't use that type of language here.`,
                "color": colors.error,
                "timestamp": Date.now(),
                "author": {
                    "name": warnedUser.username,
                    "icon_url": warnedUser.avatarURL()
                }
            }
        };
    };
    /**
     * Lets the user know why their command will be ignored
     */
    busyRestarting() {
        return {
            "embed": {
                "title": "Restart pending",
                "description": `${emojis.cross} Sorry, I cant start any more operations right now. Try again later`,
                "color": colors.error,
            }
        }
    }
    /**
     * Tells the user to f*ck off
     */
    slowDown() {
        return {
            "embed": {
                "title": "Woah now",
                "description": `${emojis.cross} Please slow down!`,
                "color": colors.error,
            }
        }
    }
    /**
     * Returns an embed for general help, or a specific command when provided
     * @param {string=} section The command to see help for
     */
    help(section) {
        if (!section) {
            return {
                "embed": {
                    "title": "Help",
                    "description": "My job is to integrate this server with the Gw2 API\nUse 'help <command>' to see more info about it\n**Commands:**\n\`\`\`\n> Help\n> Ping\n> Link\n> Unlink\n> Info\`\`\`\n**Admin commands:**\n\`\`\`\n> roleAdd\n> roleRemove\n> roles\`\`\`",
                    "color": colors.default,
                }
            }
        } else {
            switch (section.toLowerCase()) {
                case "help":
                    let hResp = [`"You're mocking me, aren't you"`, "Bruh...", "Idiot lol...", "No. Get rekt...", "Too bad...", "lol thats funny...", "Thats funny...", "I hope you're kidding...", "Say sike right now...", "Thats kinda sus...", "...", "I hope that's a joke...", "You're spamming this to see all the responses, aren't you...", "Dude...", "Seriously?", "What the H-E double C?", "No. Get hecked...", "Hahahahahaha **no**...", "Dang bro you got the whole squad laughing...", "Why are you like this?", "You must be bored as hell...", "Too bad LOL...", "How did you make it this far on Discord?"]
                    let hNum = Math.round(Math.random() * hResp.length)
                    return {//a little easter egg
                        "embed": {
                            "description": `You want a description for the help command?\n*${hResp[hNum]}*`,
                            "color": colors.default,
                        }
                    }
                    break;

                case "ping":
                    return {
                        "embed": {
                            "title": "Ping",
                            "description": "This command shows the connection speed to Discord on my end.",
                            "color": colors.default,
                        }
                    }
                    break;

                case "link":
                    return {
                        "embed": {
                            "title": "Link",
                            "description": "This command will start the linking process for your Gw2 account. You'll receive a DM when this command is used.",
                            "color": colors.default,
                        }
                    }
                    break;

                case "unlink":
                    return {
                        "embed": {
                            "title": "Unlink",
                            "description": "If your Gw2 account is linked, this command will erase all local data for it.",
                            "color": colors.default,
                        }
                    }
                    break;

                case "info":
                    return {
                        "embed": {
                            "title": "Info",
                            "description": "Displays helpful information, mostly for debugging.",
                            "color": colors.default,
                        }
                    }
                    break;
                ///////////////////////////////////////////////////////////////////////// WORK IN PROGRESS
                case "roleadd":
                    return {
                        "embed": {
                            "title": "roleAdd",
                            "description": "This topic is under construction",
                            "color": colors.error,//dont forget to change the color back
                        }
                    }
                    break;

                case "roleremove":
                    return {
                        "embed": {
                            "title": "roleRemove",
                            "description": "This topic is under construction",
                            "color": colors.error,
                        }
                    }
                    break;
                ////////////////////////////////////////////////////////////////////////////////////
                case "roles":
                    return {
                        "embed": {
                            "title": "Roles",
                            "description": "Displays all the linked roles and a bit of info for each one.",
                            "color": colors.default,
                        }
                    }
                    break;

                default:
                    return {
                        "embed": {
                            "description": "That topic doesn't exist",
                            "color": colors.error,
                        }
                    }
                    break;
            }
        }
    }
    /**
     * This should be pretty obvious
     */
    settings() {
        return {
            "embed": {
                "title": "Settings",
                "description": `Usage: set <setting> <value?>\`\`\`md
- "unregisteredRole" => a role ID given to unregistered users
- "muterole" => a role ID to mute people with
- "blockprofanity" => whether profanity should be deleted (false by default)
        \`\`\`        
                `,
                "color": colors.default
            }
        }
    }
    /**
     * My god why am I even writing these
     */
    linkGuide() {
        return {//sent to users who use the "link" command
            "embed": {
                "title": "Setup guide",
                "description": "Here's how to link your account:\`\`\`md\n1. Go to https://account.arena.net/applications\n2. How you manage your keys is up to you, but I need to see which guilds you're in for this to work\n3. Copy the API key you'd like to use, and paste it here\`\`\`\nIf you've changed your mind, you can ignore this message or say 'cancel'",
                "color": colors.default
            }
        };
    };
    /**
     * This one is obvious too
     * @param {String} string The message for the user
     */
    success(string) {//wraps strings in a success embed message
        return {
            "embed": {
                "description": `${emojis.check} ${string}`,
                "color": colors.success
            }
        };
    };
    /**
     * For when the user tries commands they don't have perms for like an idiot
     */
    noPerms() {
        return {
            "embed": {
                "description": `${emojis.cross} You don't have permission to do that`,
                "color": colors.error
            }
        };
    };
    /**
     * The word that makes me cringe
     * @param {string} string The error message to send
     */
    error(string) {//warps strings in an error embed message
        return {
            "embed": {
                "description": `${emojis.cross} ${string}`,
                "color": colors.error
            }
        };
    };
};
class ServerSettings {
    constructor() {
        this.blockProfanity = false
        /**@type {Webhook[]} Webhooks used to enforce the profanity filter*/
        this.webhooks = []
        /**@type {string} The role ID to assign to unlinked accounts*/
        this.unregisteredRole = ""
        /**@type {Link[]} Used to link guild ranks to Discord roles*/
        this.links = []
    }
}
class Webhook {
    /**
     * Used to find the appropriate url while enforcing the profanity filter
     * @param {string} channel The Discord channel ID
     * @param {string} url The webhook URL to post to
     */
    constructor(channel, url) {
        this.channel = channel
        this.url = url
    }
}
class Link {
    /**
     * Used to link Discord roles to guild Ranks
     * @param {number} rank The corresponding position as a number e.g. "0" = Everyone, "1" = Leader, "2" = Officer, and so on
     * @param {string} role The Discord role ID to give 
     * @param {string} guild The guild ID to check for
     */
    constructor(rank, role, guild) {
        this.rank = rank
        this.role = role
        this.guilds = guild
    }
}
class Account {
    /**
     * Used for linking and tracking of users
     * @param {string} id The Discord ID
     * @param {string} key The Gw2 API key
     * @param {string} gwId The Gw2 account ID
     * @param {string[]} guilds An array of guild IDs the user is in
     */
    constructor(id, key, gwId, guilds) {
        this.id = id;
        this.key = key;
        this.time = Date.now()
        this.guilds = guilds
        this.gwId = gwId
    }
}
class Guild {
    /**
     * Used to cache guilds from Gw2
     * @param {string} name The name of the guild - Never use this to identify guilds, it may change.
     * @param {string} leader The Discord ID of the owner
     * @param {string} id The guild ID - What should be used to identify them
     * @param {string} tag The guild tag e.g. [YOLO]
     */
    constructor(name, id, tag, leader) {
        /**@type {Rank[]} */
        this.ranks = [];
        this.name = name
        this.id = id
        this.tag = tag
        /**@type {string[]} */
        this.aliases = []
        this.leader = leader
    }
};
class Rank {
    /**
     * Guild Rank. For use in Guild.ranks[] only
     * @param {string} id The guild rank name e.g. "Officer" or "Member"
     * @param {number} order The corresponding position as a number e.g. "0" = Everyone, "1" = Leader, "2" = Officer, and so on
     */
    constructor(id, order) {
        this.id = id;
        this.order = order;
    }
}
//#endregion

//update embed colors with the colors object

//memory leak detected with event emitter
//'close' events are being duplicated
//could also be app.js

//filter needs to use a different library. This one has serious latency issues
//use performance tester and find ways to improve this shitty code

//#region Message handler
client.on("message", (msg) => {
    if (rateLimitMode) return;
    if (msg.mentions.has(client.user, { 'ignoreDirect': false, 'ignoreEveryone': true, 'ignoreRoles': true }) && msg.content.length <= 25) {//when it's mentioned
        msg.channel.send(Embeds.prototype.default("👋 Hey there! My prefix is `" + config.prefix + "` Use `" + config.prefix + "help` to see a list of commands"));
    };
    if (waitList.has(msg.author.id) && msg.channel.type == "dm") { handleWaitResponse(msg.author, msg.content); return };//handle when people reply to the link guide if they're on the waitlist

    //filter area
    if (msg.content && fetchSettings(msg.guild.id).blockProfanity && msg.deletable && !msg.author.bot && !msg.webhookID && msg.channel.type != "dm") {//check for profanity - ignore if no action can be taken
        if (fetchSettings(msg.guild.id).webhooks != []) {//if theres a bad word and a webhook is setup
            let rawMessage = msg.content.replace(/\s/g, "")//removes spaces that try to bypass it
            let cleanedMessage = rawMessage.replace(wordRegex, function (match) { return match.replace(/./g, '#'); });
            if (cleanedMessage != rawMessage) {//if changes were made, delete the message and replace it
                let spaceLocations = []
                let counter = 0;
                msg.content.split("").forEach(c => {//finds spaces throughout the message
                    if (c == " ") {
                        spaceLocations.push(counter)
                    }
                    counter++;
                })
                spaceLocations.forEach(l => {//puts them back, to prevent destruction while filtering
                    cleanedMessage = cleanedMessage.substring(0, l) + " " + cleanedMessage.substr(l)
                })
                let hook = fetchSettings(msg.guild.id).webhooks.find(w => w.channel == msg.channel.id)
                let name;
                if (msg.member.nickname) {
                    name = msg.member.nickname;
                } else {
                    name = msg.author.username;
                }
                if (hook) {
                    webPush.open("POST", hook.url);
                    webPush.setRequestHeader('Content-type', 'application/json');//set headers
                    webPush.send(JSON.stringify({
                        username: name,
                        avatar_url: msg.author.avatarURL(),
                        content: cleanedMessage
                    }));
                };
                msg.delete({ "reason": "This message violated the profanity filter" })//delete the message ASAP. Timeout is to give async chunks time
            }
        };
    };
    //
    if (msg.author.bot || !msg.content.startsWith(config.prefix) || config.blacklist.includes(msg.author.id) || msg.system || msg.webhookID) return;//ignores bots, DMs, people on blacklist, and anything not starting with the prefix
    let messageArray = msg.content.split(" ");
    let command = messageArray[0].substring(config.prefix.length).toLowerCase();
    const args = messageArray.slice(1);

    switch (command) {
        case "help":
            if (args[0]) {//topic specified
                msg.channel.send(Embeds.prototype.help(args[0]));
            } else {//default embed
                msg.channel.send(Embeds.prototype.help());
            }
            break;

        case "ping":
            msg.channel.send(Embeds.prototype.default(`Response time: ${client.ws.ping} ms`, "Pong!"));
            break;

        case "blacklist":
            if (msg.author.id != config.ownerID) { msg.react(emojis.cross); return; };
            if (args[0].toLowerCase() == "add") {
                if (args[1]) {
                    client.users.fetch(args[1]).then(bMem => {//Callback needed for fetch being async. CURSE YOU DISCORD.JS CACHE!!!!
                        if (!bMem) { msg.channel.send(Embeds.prototype.error("Unknown user")); return; } else {
                            if (!config.blacklist.includes(bMem.id)) {
                                config.blacklist.push(bMem.id)
                                msg.channel.send(Embeds.prototype.success(`<@${bMem.id}> was added to the blacklist`));
                            } else {
                                msg.channel.send(Embeds.prototype.error("This user is already on the blacklist"))
                            }
                        }
                    })
                } else {
                    msg.channel.send(Embeds.prototype.error("Please provide a user ID"))
                }
            } else if (args[0].toLowerCase() == "remove") {
                client.users.fetch(args[1]).then(bMem => {
                    if (!bMem) { msg.channel.send(Embeds.prototype.error("Unknown user")); return; } else {
                        if (config.blacklist.includes(bMem.id)) {
                            let bInd = config.blacklist.findIndex(b => b == bMem.id)
                            if (bInd != -1) config.blacklist.splice(bInd);
                            else { msg.channel.send(Embeds.prototype.error("Something went wrong wile changing the blacklist")); return; }
                            msg.channel.send(Embeds.prototype.success(`<@${bMem.id}> was removed from the blacklist`))
                        } else {
                            msg.channel.send(Embeds.prototype.error("This user isn't on the blacklist"))
                        }
                    }
                })
            } else {
                msg.channel.send(Embeds.prototype.error("Usage: blacklist [add/remove] [userID]"))
            }
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
                msg.channel.send(Embeds.prototype.default(`This command links a role to a guild to be assigned automatically\n**Usage:** roleAdd <roleID> <rank> <guild>\nUse '${config.prefix}guild' to see available ranks`));
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
                        let newRole = new Link(rank, role.id, guild.id);
                        if (!fetchSettings(msg.guild.id).links) {//if its null and needs to be set up
                            fetchSettings(msg.guild.id).links = [newRole]
                        } else {//already setup, push to it
                            fetchSettings(msg.guild.id).links.push(newRole)
                        }
                        /////////////////////////////////////////////////
                        msg.channel.send(Embeds.prototype.success(`Link successful`));
                    } else {
                        msg.channel.send(Embeds.prototype.error("No changes were made"));
                    }
                }).catch(() => {
                    msg.channel.send(Embeds.prototype.error("No changes were made"));
                });
            };
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
                    let remRole = fetchSettings(msg.guild.id).links.find(r => r.role == args[0])
                    if (!remRole) {
                        msg.channel.send(Embeds.prototype.error("This role isn't linked to any guilds"))
                        return;
                    } else {
                        let remIndex = fetchSettings(msg.guild.id).links.findIndex(r => role == args[0])
                        msg.channel.send(Embeds.prototype.success(`<@&${remRole.role}> was unlinked`))
                        fetchSettings(msg.guild.id).links.splice(remIndex)
                        return;
                    }
                } catch (error) {
                    log('ERR', `Failed to delete link to ${args[0]} : ${error}`);
                    msg.channel.send(Embeds.prototype.error(`Failed to unlink this role, check 'roles', It might not exist`));
                };
            };
            break;

        case "roles":
            if (msg.channel.type == "dm") { msg.channel.send(Embeds.prototype.error("This command can only be used in servers")); return; };
            let collected = [];
            //create a list of configured roles for this server
            let links = fetchSettings(msg.guild.id).links;
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
            let gcGuild = searchGuilds(args[0]);
            if (gcGuild) {
                let rankBlock = "```\n0 : [Everyone]"//open the block
                if (gcGuild.ranks.length >= 1) {//ranks there
                    gcGuild.ranks.forEach(r => {
                        rankBlock += `\n${r.order} : ${r.id}`
                    })
                    rankBlock += "```"//close the block
                } else {//no ranks
                    rankBlock += "\n```\nThe guild owner needs to link their account for other ranks to work";
                }
                msg.channel.send(Embeds.prototype.default(`**${gcGuild.name} [${gcGuild.tag}]**\nID: ${gcGuild.id}\nRanks:\n${rankBlock}`))//god, please forgive me for this line
            } else {
                msg.channel.send(Embeds.prototype.error("I'm not sure which guild you're referring to"))
            }
            break;

        case "server":
            //depreciated command
            if (msg.channel.type == "dm") { msg.channel.send(Embeds.prototype.error("This command can only be used in servers")); return; };
            let s = JSON.stringify(fetchSettings(msg.guild.id), null, 1);//try to format while keeping it compact for embed
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
            //allows the server owner to change server specific settings
            if (msg.channel.type == "dm") { msg.channel.send(Embeds.prototype.error("This command can only be used in servers")); return; };
            if (!(msg.member.permissions.has('MANAGE_GUILD' || msg.member.permissions.has('ADMINISTRATOR')))) { msg.channel.send(Embeds.prototype.error("Sorry, only the server staff can use this")); return; };
            if (!args[0]) {//no args - show help page
                msg.channel.send(Embeds.prototype.settings())
                return;
            }
            switch (args[0].toLowerCase()) {
                case "unregisteredrole":
                    if (!args[1]) {//missing argument - show current setting
                        if (!fetchSettings(msg.guild.id).muteRole) {
                            msg.channel.send(Embeds.prototype.default("This setting is empty"))
                        } else {
                            msg.channel.send(Embeds.prototype.default(`<@&${fetchSettings(msg.guild.id).unregisteredRole}> (${fetchSettings(msg.guild.id).unregisteredRole})`, "Current setting"))
                        }
                    } else {//args good
                        if (args[1] == "clear" || args[1] == "null" || args[1] == "reset") {//reset
                            fetchSettings(msg.guild.id).unregisteredRole = ""
                            msg.channel.send(Embeds.prototype.success("Setting reset"))
                            return;
                        };
                        let role = msg.guild.roles.cache.find(r => r.id == args[1])
                        if (!role) { msg.channel.send(Embeds.prototype.error("That tole doesn't exist")); return; };
                        prompt(msg.author, msg.channel, `This will give <@&${role.id}> to all unlinked accounts.\nProceed?`).then(r => {
                            if (r) {
                                fetchSettings(msg.guild.id).unregisteredRole = role.id
                                msg.channel.send(Embeds.prototype.success("Role linked\nSet to 'null' to undo these changes"));
                            } else {
                                msg.channel.send(Embeds.prototype.error("No changes were made"));
                            }
                        })
                    };
                    break;

                case "blockprofanity":
                    if (!args[1]) {//show current setting
                        msg.channel.send(Embeds.prototype.default(`\`\`\`${fetchSettings(msg.guild.id).blockProfanity}\`\`\``, "Current setting"))
                    } else {
                        if (args[1] == "off" || args[1] == "false" || args[1] == "reset") {//reset 
                            if (!fetchSettings(msg.guild.id).blockProfanity) {//stops if its already setup
                                msg.channel.send(Embeds.prototype.error("This feature is already disabled"));
                                return;
                            }
                            fetchSettings(msg.guild.id).blockProfanity = false
                            msg.guild.fetchWebhooks().then(hooks => {//fetch all hooks // skips cache to avoid deleting hooks that were already deleted for some reason
                                hooks.forEach(hook => {//for each
                                    let ind = fetchSettings(msg.guild.id).webhooks.findIndex(h => h.url == hook.url)//find the hook under the server object
                                    if (ind != -1) {//if it exists
                                        hook.delete(`${msg.author.username} disabled the profanity filter`).catch((err) => {
                                            msg.channel.send(Embeds.prototype.error("Failed to delete the webhooks! Please check my permissions and try again"))
                                            return;
                                        })
                                    }
                                })
                                fetchSettings(msg.guild.id).webhooks = [];//set the array to empty just to be sure
                            })
                            msg.channel.send(Embeds.prototype.success("Profanity filter disabled"))
                            return;
                        } else if (args[1] == "on" || args[1] == "true") {
                            if (fetchSettings(msg.guild.id).blockProfanity) {//stops if its already setup
                                msg.channel.send(Embeds.prototype.error("This feature is already enabled"));
                                return;
                            }
                            prompt(msg.author, msg.channel, "Webhooks are used to enforce the profanity filter, and one will be created for each channel.\nContinue?").then(r => {
                                if (r) {
                                    if (msg.guild.me.hasPermission('MANAGE_WEBHOOKS')) {
                                        if (!fetchSettings(msg.guild.id).webhooks) fetchSettings(msg.guild.id).webhooks = []//start setup
                                        msg.guild.channels.cache.filter(c => c.type == 'text').forEach(ch => {//this may be causing ratelimit issues
                                            client.channels.fetch(ch.id, true).then(channel => {//fetch and create webhook - use cache to avoid ratelimit
                                                channel.createWebhook("Profanity filter: #" + ch.name, { "avatar": "https://raw.githubusercontent.com/ALU52/DRA_bot/master/profanity.png", "reason": "Filter enabled by " + msg.author.username }).then(webhook => {
                                                    fetchSettings(msg.guild.id).webhooks.push(new Webhook(webhook.channelID, webhook.url))//save it to memory for later use
                                                }).catch((err) => {
                                                    log('ERR', `Failed to create webhook: ${err.message}`)
                                                    fetchSettings(msg.guild.id).blockProfanity = false
                                                    msg.channel.send(Embeds.prototype.error("Something went wrong during filter setup"))
                                                    return;
                                                })
                                            })
                                        })
                                        fetchSettings(msg.guild.id).blockProfanity = true//enable the filter
                                        msg.channel.send(Embeds.prototype.success("Profanity filter enabled"))//let them know it finished afterwards
                                    } else {
                                        msg.channel.send(Embeds.prototype.error("I don't have permission to manage webhooks"))
                                        return;
                                    }
                                } else {
                                    msg.channel.send(Embeds.prototype.error("No changes were made"))
                                    return;
                                }
                            })
                            return;
                        } else {
                            msg.channel.send(Embeds.prototype.default("This setting can only be 'true' or 'false'", "Invalid syntax"))
                            return;
                        }
                    }
                    break;

                default:
                    msg.channel.send(Embeds.prototype.error("Unknown setting"))
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
var queUpUsers = setInterval(() => {//adds every account to the update que - looks like its ignoring offline users, not sure how to fix this
    if (roleQueue.length >= 10) return;//ignore if theres already a lot in there
    client.guilds.cache.forEach(g => {//needs to fetch all members, not users
        g.members.fetch().then(members => {//try fetching first
            members.forEach(mem => {
                if (!mem.user.bot) roleQueue.unshift(mem);
            });
        }).catch((r) => {//failed to fetch, use cache instead
            g.members.cache.forEach(mem => {
                if (!mem.user.bot) roleQueue.unshift(mem);
            });
        });
    });
}, 300000);//fetches every 5 minutes

//this is to avoid making the APIs angry with me
let queueDelay = 500
var queueTick = setInterval(() => {
    if (roleQueue.length >= 1) {//only run if theres someone there
        let member = roleQueue[roleQueue.length - 1];
        if (!fetchSettings(member.guild.id) || config.ignoreList.includes(member.user.id)) {//ignore if there aren't any settings for this server or they chose to be ignored
            roleQueue.pop();
            return;
        }
        let account = accounts.find(a => a.id == member.user.id);
        if (account) {//first check if they're registered
            if (fetchSettings(member.guild.id).unregisteredRole != null) {//if the role is configured
                if (member.roles.cache.has(fetchSettings(member.guild.id).unregisteredRole)) {//if they have the role
                    member.roles.remove(fetchSettings(member.guild.id).unregisteredRole).catch(e => {//remove it
                        log('ERR', `Failed to manage ${member.id}'s roles: ${e}`);
                        roleQueue.pop();
                        return;
                    });
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
                        let acc = accounts.findIndex(a => a.id == u.id);
                        accounts.splice(acc);
                        u.send(Embeds.prototype.error(`${emojis.cross} Something went wrong when I checked your Gw2 account! It's likely the linked API key was deleted. To avoid spamming the API, your account was automatically unlinked.`));
                    }).catch((err) => {
                        log('ERR', `Error while unlinking an account for a different error:\n${err.name} : ${err.message}`)
                    })
                    roleQueue.pop();
                    return;
                };
            } else {//nah, the cache is still valid - now apply roles
                var lSettings = fetchSettings(member.guild.id);
                if (!lSettings || !lSettings.links || lSettings.links == []) { roleQueue.pop(); return; }
                lSettings.links.forEach(l => {
                    if (!l || typeof l.role != 'string') return;
                    if (account.guilds.includes(l.guild) && !member.roles.cache.has(l.role)) {
                        //this part cant be finished until I find a way to check everyones rank inside a guild
                        member.roles.add(l.role).catch(e => {
                            log('ERR', `Failed to give ${member.id} role ${l.role} : ${e}`);
                        });
                    };
                });
                roleQueue.pop();
                return;
            };
        } else {//unregistered account
            let cSettings = fetchSettings(member.guild.id)
            if (cSettings) {
                if (member.roles.cache.has(cSettings.unregisteredRole)) { roleQueue.pop(); return; };//ignore if they already have it
                member.roles.add(cSettings.unregisteredRole).catch(e => {
                    log('ERR', `Failed to give ${member.id} unregisteredRole: ${e}`);
                });
            }
            roleQueue.pop();
            return;
        }
        //anything below this line should show up as 'unreachable.' We want it that way ;)
        console.log(`Please check the queue interval. Unreachable code was triggered! Search for: MOWCMSJIN`)
    }
}, queueDelay);
//file backup
let backupTick = setInterval(() => {//saves the accounts to the file every 5 seconds
    manifest = require("./manifest.json")//time to load up the manifest again
    //verify config before saving it
    Object.getOwnPropertyNames(config).forEach(en => {//check data types
        if (!manifest.config[en]) return;//ignore if its not on the manifest for some reason
        if (typeof config[en] != manifest.config[en].type) {
            log('WARN', `Found wrong data type for ${en}! Restoring default`)
            config[en] = manifest.config[en].default
        }
    })
    Object.getOwnPropertyNames(manifest.config).forEach(en => {//now look for missing settings
        if (!config[en]) {//if its gone
            config[en] = manifest.config[en].default//bring it back!
        }
    })
    //now save it
    fs.writeFileSync(config.accountsPath, JSON.stringify(accounts, null, 4));
    fs.writeFileSync("./config.json", JSON.stringify(config, null, 4));
    let svConf = manifest.serverSettings//load up server specific settings
    client.guilds.cache.forEach(s => {//for each server
        if (!fetchSettings(s.id)) {//if settings are missing
            let newConf = {}//create new settings object
            Object.getOwnPropertyNames(svConf).forEach(c => {//for each setting from manifest
                newConf[c] = svConf[c].default//copy data from the manifest over
            })
            fetchSettings(s.id) = newConf//save it
            return;
        }
        Object.getOwnPropertyNames(fetchSettings(s.id)).forEach(ss => {//check existing settings for each server
            if (typeof fetchSettings(s.id)[ss] != svConf[ss].type) {//if its the wrong data type
                log('WARN', `Wrong data type found for ${s.id}/${ss}`)
                fetchSettings(s.id)[ss] = svConf[ss].default
            }
        })
        Object.getOwnPropertyNames(svConf).forEach(ss => {//check if any new settings need to be added
            if (!fetchSettings(s.id)[ss]) {//if its missing
                fetchSettings(s.id)[ss] = svConf[ss].default
            }
        })
    });
}, 5000);
function stopBackup() {
    clearInterval(backupTick)//stop the timer
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
            accounts.push(new Account(user.id, content, r.id, r.guilds));//add them to the account file
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
            //linked, now search for all the guilds they're in and immediately add them to the queue
        }).catch(err => {
            hwrHandle(err);
        })
    }).catch(err => {
        hwrHandle(err);
    });
    function hwrHandle(err) {
        if (err.name) log("ERR", `Failed guild setup: ${err.name}`);
        user.send(Embeds.prototype.error(`There was an error during setup. Did you provide a valid API key? Please DM <@" + ${config.ownerID} + "> if you'd like help`));
    };
};

/**
 * Searches the known guilds by name, aliases, and tags. Returns the first match.
 * Aliases are depreciated
 * @param {string} query The name or tag
 * @returns {Guild|null}
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
 * Adds a new guild to the cache
 * @param {string} id The guild ID to add
 * @param {string} key The API key to use
 * @param {boolean} owner Whether the user adding the guild is the owner. False by default
 */
function newGuild(id, key, owner) {
    //new function must be added that also reads the guild ranks if its the guild owner
    if (!config.guilds.find(g => g.id == id)) {//ignores if its already there
        apiFetch('guild/' + id, key).then(res => {//request more info about the guild, and register it
            let newGuild = new Guild(res.name, res.id, res.tag)
            log('INFO', `New guild registered: ` + res.name);
            if (owner) {
                let l = accounts.find(a => a.key == key);//finds the linked account via key
                if (l) newGuild.leader = l.id;//saves the owner's discord ID
                log('INFO', `Leader detected, adding ranks`);
                apiFetch(`guild/${id}/ranks`, key).then(res => {
                    if (!Array.isArray(res)) { log('ERR', `Got an unusual response from API while fetching ranks: ${res}`); return; };
                    res.forEach(r => {//append each rank to the guild object
                        newGuild.ranks.push({ "id": r.id, "order": r.order });
                    });
                }).then(() => {//push when its done
                    config.guilds.push(newGuild);
                }).catch(e => {
                    log('ERR', `Error while fetching ranks for ${id} : ${e}`);
                });
            } else {//push it right away because its not waiting for ranks
                config.guilds.push(newGuild);
            };
        }).catch(e => {
            log('ERR', `Error while fetching guild data for ${id} : ${e}`);
        });
    };
    ///////
};

/**
 * Converts all characters in a string to the normal letter that best represents it
 * @param {string} string The string to process
 * @returns {string|null}
 */
function normalizeString(string) {
    if (!string) return null;
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
const characterMap = {//this is probably the worst thing I've ever created // cases are separated because I'm not sure how lenient string.includes() is
    'a': ['A', 'a', 'À', 'Á', 'Â', 'Ã', 'Ä', 'Å', 'Æ', 'æ', 'ä', 'Д'],
    'b': ['B', 'b', 'ß'],
    'c': ['C', 'c', 'ç', 'Ć', 'ć', 'Ĉ', 'ĉ', 'Ċ', 'ċ', 'Č', 'č', '<'],
    'd': ['D', 'd', 'Ď', 'ď', 'Đ', 'đ'],
    'e': ['E', 'e', 'È', 'É', 'Ê', 'Ë', 'è', 'é', 'ê', 'ë', 'Æ', 'æ'],
    'f': ['F', 'f'],
    'g': ['G', 'g', 'Ĝ', 'ĝ', 'Ğ', 'ğ', 'Ġ', 'ġ', 'Ģ', 'ģ'],
    'h': ['H', 'h', 'Ĥ', 'ĥ', 'Ħ', 'ħ'],
    'i': ['I', 'i', 'Ì', 'Í', 'Î', 'Ï', 'ĳ', 'Ĳ', 'ï', '1', 'ǀ', 'Ǐ', 'ǐ'],
    'j': ['J', 'j', 'ĳ', 'Ĵ', 'ĵ', 'Ĳ'],
    'k': ['K', 'k', 'Ķ', 'ķ', 'ĸ'],
    'l': ['L', 'l', 'Ĺ', 'ĺ', 'Ļ', 'ļ', 'Ľ', 'ľ', 'Ŀ', 'ŀ', 'Ł', 'ł'],
    'm': ['M', 'm'],
    'n': ['N', 'n', 'Ń', 'ń', 'Ņ', 'ņ', 'Ň', 'ň', 'ŉ', 'Ŋ', 'ŋ', 'И'],
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
    'z': ['Z', 'z', 'Ź', 'ź', 'Ż', 'ż', 'ž']
};

/**
 * Logs an event
 * @param {("INFO"|"WARN"|"ERR")} type The event type
 * @param {string} message The event message
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
* @returns {Promise<Object>} The parsed JSON response. If a "text" property exists, it's probably an error
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
 * Finds and returns server specific settings from the config
 * Intellisense doesn't have the common sense to disregard selector expressions when all the objects in the array have the same structure...
 * So this is my workaround....
 * @param {string} server The Discord server ID
 * @returns {ServerSettings|null}
 */
function fetchSettings(server) {
    let sett = config.serverSettings[server];
    if (sett) {
        return sett;
    } else {
        return null;
    };
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
client.once("ready", () => {
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
});
client.on('guildMemberAdd', (member) => {
    let serverSettings = fetchSettings(member.guild.id);
    if (serverSettings.unregisteredRole != null) {//unregistered role is enabled, fetch it
        member.guild.roles.fetch(serverSettings.unregisteredRole).then(r => {//I keep forgetting that roles.fetch() is async
            if (!r) { log('ERR', `Tried to give an unregistered role, but it seems like ${r.id} doesn't exist `); return; };
            if (!member.manageable) { log('ERR', `I don't have permissions to manage${member.id} in ${member.guild.id}`); return; };
            member.roles.add(r).catch((err) => {
                log('ERR', `UnregisteredRole for ${member.guild.name} seems to be misconfigured!\n${err.name} : ${err.message}`);
            });
        }).catch((err) => {
            log('ERR', `UnregisteredRole for ${member.guild.name} seems to be misconfigured!\n${err.name} : ${err.message}`);
        });
    };
});
client.on('disconnect', () => {
    log('ERR', `I've lost connection!`);
})
client.on('warn', (warn) => {
    log('WARN', warn);
})
process.on('warning', (err) => {
    log('WARN', `${err.name} : ${err.message}\n${err.stack}`)
})
client.on('rateLimit', (data) => {
    log('WARN', `Ratelimit: ${data.route} / ${data.path} : ${data.method} - ignoring messages for a sec`)
    rateLimitMode = true;
    setTimeout(() => {
        rateLimitMode = false;
    }, 2500);
})
client.on('error', (err) => {
    log('ERR', `Uncaught exception: ${err.name}:${err.message}\n${err.stack}`);
})
process.on('uncaughtException', (err) => {
    log('ERR', `Uncaught exception: ${err.name}:${err.message}\n${err.stack}`);
})
process.on('message', (m) => {//manages communication with parent
    switch (m) {
        case "shutdown":
            log('INFO', "Cleaning up...");
            shutdownPending = true;//tells the rest of the bot not to start any new operations
            clearInterval(queUpUsers);//stop adding users to the queue - try to let the queue finish before stopping
            clearInterval(scrollInterval);//stop updating presence and change to restart message
            if (client.user) client.user.setPresence({ status: "dnd", activity: { name: "with system files", type: "PLAYING" }, });
            stopBackup();//save one final time and stop writing to the files
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