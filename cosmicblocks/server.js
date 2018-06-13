

//   ****  ****   **      ***   ** **  //
//  **     ** **  **     ** **   ***   //
//  **     ****   **     ** **    *    //
//  **     ** **  **     ** **   ***   //
//   ****  ****   *****   ***   ** **  //

/*
Arrows:

 7|8|9
=======
 4| |6
=======
 1|2|3

arrow1: left-down
arrow2: down
arrow3: right-down
arrow4: left

arrow6: right
arrow7: left-top
arrow8: top
arrow9: top-right
*/

'use strict';

//////////////////////////////////////////////////
// Configurable constants

const HOSTNAME = 'https://cblox.fun'; // put the HTTPS domain name here. 1 dollar domains FTW

const packageJson = require('../package.json');
const APP_VERSION = packageJson.version;
const APP_NAME    = packageJson.name;

const HTTP_PORT = 80; //we run an HTTP server that just forwards to the HTTPS server

// timing how long server booting up takes.
// takes longer if production because i minify the client js which takes >10sec.
const start = new Date();


// server variables
var userData = {}; // socket id is the key, contains username, wins, losses, draws, room.
var gameData = {}; // board data, creator, title, players, timer, timelimit, timevalue,

const emptyColor = '#d5ccbd'; // try to remove this...

const CREDENTIALS = require('./credentials.js');

var fs = require('fs');

var httpsOptions = {
	key  : fs.readFileSync( 'ssl/key.pem'  ),
	cert : fs.readFileSync( 'ssl/cert.pem' )
};

//////////////////////////////////////////////////

//var compressor = require('node-minify');

var crypto = require('crypto');

var https = require('https');
var http  = require('http');

var express = require('express');
var app = express();

var path = require('path');
var signature = require('cookie-signature');
var cookie = require('cookie');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');

// for db connection
var orm = require('orm');

// passport is used for logging in with twitter.
var passport = require('passport');
var TwitterStrategy = require('passport-twitter').Strategy;
var passportSocketIo = require("passport.socketio");

// it uses sessions. at the moment they are just stored in memory using session-memory-store.
// i may move that to the database later?
var expressSession = require('express-session');
var MemoryStore  = require('session-memory-store')(expressSession); //todo: remove this dependency with session garbage collection
var sessionStore = new MemoryStore();

//var hsl = require('hsl-to-hex'); // color tool


/*
// render CSS
var sass = require('node-sass');
sass.render({
	file: './cosmicblocks/style.scss',
	outFile: './cosmicblocks/client/style.css',
	outputStyle: 'compressed',
}, function(error, result) {
	if(!error){
		fs.writeFile('./cosmicblocks/client/style.css', result.css, function(err){
			if(!err){
				console.log('minified style.scss successfully.');
			} else {
				console.log('Sass failure!!');
				console.log(err);
			}
		});
	} else {
		console.log('Sass failure!!');
		console.log(error);
	}
});
*/


////////////////////////////////////////
// process.env.NODE_ENV is set via the scripts in package.json
// there are two scripts: start, and test.
// each listens on a different PORT. test will not save data to the database (except login/new user).
if (process.env.NODE_ENV === 'start') {
	//var HTTPS_PORT = 8888;
	var HTTPS_PORT = 443;
	var saveData = true;
	
	/*
	compressor.minify({
		compressor: 'gcc',
		input: './cosmicblocks/client.js',
		output: './cosmicblocks/client/client.js',
		callback: function (err, min) {
			if (!err) {
				console.log('minified client.js successfully.');
			} else {
				console.log('node-minify failure!');
			}
		}
	});
	*/
	
	fs.createReadStream('./cosmicblocks/client.js').pipe(fs.createWriteStream('./cosmicblocks/client/client.js'));

} else if (process.env.NODE_ENV === 'test') {
	//var PORT = 9001;
	var HTTPS_PORT = 443;
	var saveData = false;
	
	fs.createReadStream('./cosmicblocks/client.js').pipe(fs.createWriteStream('./cosmicblocks/client/client.js'));
	
} else {
	console.log("NODE_ENV is not set correctly.");
	//process.exit(1); // kill the server
	console.log("Defaulting to production settings...");
	var HTTPS_PORT = 443;	
	var saveData = true;
}

console.log('Running '   + APP_NAME +' v'+ APP_VERSION );
console.log('NODE_ENV : '+ process.env.NODE_ENV );
console.log('Save Data: '+ saveData );
console.log('Host/Port: '+ HOSTNAME +':'+ HTTPS_PORT );

////////////////////////////////////////


function pad(number) {
	var r = String(number);
	if ( r.length === 1 ) r = '0' + r;
	return r;
}
	
function getUTCDateTime(){
	var d = new Date();
    var utc = '';
	utc += d.getUTCFullYear();
    utc += '-'+ pad( d.getUTCMonth() + 1 );
    utc += '-'+ pad( d.getUTCDate() );
    utc += 'T'+ pad( d.getUTCHours() );
    utc += ':'+ pad( d.getUTCMinutes() );
    utc += ':'+ pad( d.getUTCSeconds() );
    utc += '.'+ String( (d.getUTCMilliseconds()/1000).toFixed(3) ).slice(2,5);
    utc += 'Z';
	return utc;
}

function chatLog(channel, user, msg){
	console.log( getUTCDateTime() +' <#'+ channel +'> '+ user +': '+ msg );
	//todo log to file ex gamelogs/game-a1b2c3.log
}

function sysLog(msg){
	console.log( getUTCDateTime() +' '+ msg );
	//todo log to file ex cblox-01-01-2018.log
}


var handleDBResult = function(err, User, db) {
	
	if ( err ) {
		console.log("handleDBResult error:");
		console.log(err);
		return;
	}
	
	// Create HTTP server so user's don't 404 if they try to connect by HTTP by mistake.
	var httpServer = http.createServer(app, function(req, res) {
		res.end();
	}).listen( HTTP_PORT );
	
	// Create the HTTPS server.
	var server = https.createServer(httpsOptions, app, function(req, res) {
		res.end();
	}).listen( HTTPS_PORT );
	console.log('Server listening on: '+ HOSTNAME +':'+ HTTPS_PORT);

	// socket.io is used for having a realtime application.
	// all of the game-related stuff is passed between client and server via socket.io.
	var io = require('socket.io')(server);
	
	io.use(passportSocketIo.authorize({
		secret : CREDENTIALS.sessionSecret,
		key    : CREDENTIALS.sessionKey,
		store  : sessionStore,
		cookieParser: cookieParser
	}));
	
	// i think the secret and the key can just be whatever, as long as they match between the app and io.
	app.use(expressSession({
		secret : CREDENTIALS.sessionSecret, 
		key    : CREDENTIALS.sessionKey, 
		store  : sessionStore,
		resave : false, 
		saveUninitialized : false,
		//cookie : { secure : false }
	}));

	app.use(passport.initialize());
	app.use(passport.session());
	
	passport.use('twitter', new TwitterStrategy({
		consumerKey    : CREDENTIALS.twitterConsumerKey,
		consumerSecret : CREDENTIALS.twitterConsumerSecret,
		callbackURL    : HOSTNAME +':'+ HTTPS_PORT +'/login/twitter/callback' //todo: improve this(?) 
	},
	function(token, tokenSecret, profile, done) {
		process.nextTick(function() {
			// process.nextTick used to wait til the data arrives (??)
			if (typeof profile !== 'undefined') {
				// the profile may be undefined if you just try to connect to the success url...
				var userInfo = {
					twitterid   : profile.id,
					username    : profile.username,
					displayName : profile.displayName
				};
				return done(null, userInfo);
			}
		});
	}));	
	
	/*	
	// add the table to the database
	db.sync(function(err) {
		if (err) throw err;
		var userInfo = undefined;
		var passedColor = assignColor();
		var tempWins = 0;
		var tempDraws = 0;
		var tempLosses = 0;
		var tempElo = -99999;
		var tempGamesPlayed = 0;
		
		if (typeof User !== 'undefined') {
			User.find({ twitterID: profile.id }, function (err, users){ // this line can fail if try to connect to app before db is connected properly, User undefined.
				if (err) throw err;
				if (users.length === 0) {
					// no user, so we must create it.
					User.create({ 
						displayName: encodeURI(profile.displayName), 
						wins: 0,
						draws: 0,
						losses: 0,
						elo: -99999,
						color: passedColor,
						twitterID: profile.id,
						gamesPlayed: 0,
						twitterHandle: profile.username,
						forfeits: 0,
						//winsByForfeit: 0,
						avgMoveCount: 0,
						connections: 0,
						timePlayed: 0
					}, function(err) {
						if (err) throw err;
					});
					console.log ('@' + profile.username + ' created.');
				} else {
					// found a user, replace temp values w/ db values
					users[0].displayName = encodeURI(profile.displayName);
					users[0].twitterHandle = profile.username;
					passedColor = users[0].color;
					tempWins = users[0].wins;
					tempDraws = users[0].draws;
					tempLosses = users[0].losses;
					tempGamesPlayed = users[0].gamesPlayed;
					tempElo = users[0].elo;
					
					users[0].save(function (err) {
						if (err) throw err;
						console.log ('@' + users[0].twitterHandle + ' connected.');
					});
				}
				
				userInfo = {
					twitterid: profile.id,
					username: profile.username,
					displayName: profile.displayName,
					color: passedColor,
					wins: tempWins,
					draws: tempDraws,
					losses: tempLosses,
					elo: tempElo,
					gamesPlayed: tempGamesPlayed
				};
	*/
	
	//place user's id in cookie
	passport.serializeUser(function(user, done)   { done(null, user); });
	
	//retrieve user from db
	passport.deserializeUser(function(user, done) { done(null, user); });

	////////////////////////////////////////////////////////////
	// ExpressJS HTTPS Endpoints
	
	// on the landing page just immediately perform a twitter autheticate.
	//app.get('/', passport.authenticate('twitter'));
	
	app.get('/', function(req, res) {
		//enforce HTTPS but dont 404 HTTP users
		if(!req.secure) { res.redirect( HOSTNAME ); return; }
		
		res.redirect('/play');
	});
	
	//app.get('/success', function(req, res) {
	app.get('/play', function(req, res) {
		//enforce HTTPS but dont 404 HTTP users
		if(!req.secure) { res.redirect( HOSTNAME ); return; }
		
		//console.log(req.user);
		
		if (typeof req.user === 'undefined') { //no req.user = user is not logged in.
		
			////////////////////////////////////////
			// Create an anon user, save it to their session and reload.
			
			////////////////////////////////////////
			// Create emoji anonID's ex Anon Peach🍑
			// the name list is really stupid but I like it
			var anonNames = require('./anonNames.js'); // todo: make an enums folder for all game stuff (boards, blocks, movelist)
			var nameID    = rand(0, anonNames.length);
			var randTwitterID = ''+ (rand(1, 10000000) * -1);
			
			var userInfo = {
				twitterid   : randTwitterID, //anons have negative twitterID for now
				username    : anonNames[nameID],
				displayName : anonNames[nameID]
			};
			
			req.login( userInfo, function(err) {
				if (err) { console.log(err); }
				res.redirect('/play');
			});
			////////////////////////////////////////
			
			/*
			////////////////////////////////////////
			// Create generic anonID's ex Anon4691
			var randNameID    = rand(1,9999);
			var randTwitterID = rand(1,10000000);
			
			var userInfo = {
				twitterid   : ''+ randTwitterID*-1, //anons have negative twitterID for now
				username    : 'Anon'+ randNameID,
				displayName : 'Anon'+ randNameID
			};
			
			req.login( userInfo, function(err) {
				if (err) { console.log(err); }
				res.redirect('/play');
			});
			////////////////////////////////////////
			*/
			
			//res.redirect('/failure'); //used to fail if no twitter login
			////////////////////////////////////////
			
		} else {
			// send client/index.html
			app.use(express.static(path.join(__dirname, '/client/')));
			res.sendFile(path.join(__dirname + '/client/'));
		}
	});

	////////////////////////////////////////
	// Twitter login endpoints
	
	//app.get('/login', passport.authenticate('twitter'));
	app.get('/login/twitter', passport.authenticate('twitter'));

	// handle the callback after twitter has authenticated the user
	app.get('/login/twitter/callback', 
		passport.authenticate('twitter', { failureRedirect: '/login/failure' }),
		function(req, res) {
			//login was successful
			//console.log(req.session.passport.user);
			res.redirect('/play');
	});
	
	app.get('/login/failure', function(req, res){
		app.use(express.static(path.join(__dirname, '/client/')));
		res.sendFile(path.join(__dirname + '/client/failure.html'));
	});		
	////////////////////////////////////////	
	
	// END OF EXPRESSJS ENDPOINTS
	////////////////////////////////////////////////////////////

	
	var end = new Date();
	var timeTaken = ((end - start) / 1000);
	console.log('Execution time: '+ timeTaken +'s');
	
	
	////////////////////////////////////////////////////////////
	// SOCKET.IO handlers
	
	io.on('connection', function(socket){
		
		////////////////////////////////////////
		// Twitter Authentication
		var duplicate = false;
		for (var key in userData) {
			if (userData[key].twitterid === socket.request.user.twitterid) duplicate = true;
			console.log('Duplicate found in userData: '+ userData[key].username);
		}
		
		if (duplicate) {
			//create user as a ghost
			userData[socket.id] = {
				username : socket.request.user.displayName +' (ghost)',
				room     : false,
				color    : '#808080',
				ghost    : true
			};
			welcome(socket.id);
			
		} else {
		
			// if we are recording stats, increment connections.
			if (saveData) {
				
				db.sync(function(err) {
					if (err) throw err;
					User.find({ twitterID: socket.request.user.twitterid }, function (err, users){
						if (err) throw err;
						if (users.length === 0) {
							
							// no user, so we must create it.
							var passedColor = assignColor();
							userData[socket.id] = {
								twitterid   : socket.request.user.twitterid,
								username    : socket.request.user.displayName,
								room        : false,
								color       : passedColor,
								gamesPlayed : 0,
								timePlayed  : 0,
								wins        : 0,
								draws       : 0,
								losses      : 0,
								remainingRerolls: 0,
								elo         : -99999,
								ghost       : false,
								connectTime : Date.now()
							};
							
							//anons are negative twitter ids
							if( socket.request.user.twitterid < 0){
								console.log('Anonymous account: '+ socket.request.user.username +' created.');
								welcome(socket.id);
								return;
							}
							
							User.create({ 
								displayName   : encodeURI(socket.request.user.displayName), 
								wins          : 0,
								draws         : 0,
								losses        : 0,
								elo           : -99999,
								color         : passedColor,
								twitterID     : socket.request.user.twitterid,
								gamesPlayed   : 0,
								twitterHandle : socket.request.user.username,
								forfeits      : 0,
								avgMoveCount  : 0,
								connections   : 1,
								timePlayed    : 0
							}, function(err) {
								if (err) throw err;
							});
							
							console.log('User @'+ socket.request.user.username +' created.');
							
						} else {
							users[0].connections++;
							users[0].displayName = encodeURI(socket.request.user.displayName);
							users[0].twitterHandle = socket.request.user.username;
							
							userData[socket.id] = {
								twitterid   : socket.request.user.twitterid,
								username    : socket.request.user.displayName,
								room        : false,
								color       : users[0].color,
								gamesPlayed : users[0].gamesPlayed,
								timePlayed  : users[0].timePlayed,
								wins        : users[0].wins,
								draws       : users[0].draws,
								losses      : users[0].losses,
								remainingRerolls: 0,
								elo         : users[0].elo,
								ghost       : false,
								connectTime : Date.now()
							};
							
							// save the incremented 'connections'
							users[0].save(function (err) {
								if (err) throw err;
								console.log('Successfully updated: '+ users[0].displayName +' [@'+ users[0].twitterHandle +']');
							});
						}
						welcome(socket.id);
					});
				});
			} else {
				
				// no user, so we must create it.
				var passedColor = assignColor();
				userData[socket.id] = {
					twitterid   : socket.request.user.twitterid,
					username    : socket.request.user.displayName,
					room        : false,
					color       : passedColor,
					gamesPlayed : 0,
					timePlayed  : 0,
					wins        : 0,
					draws       : 0,
					losses      : 0,
					remainingRerolls: 0,
					elo         : -99999,
					ghost       : false
				};
				
				console.log ('User @'+ socket.request.user.username +' created.');
				welcome(socket.id);
			}
		}
		////////////////////////////////////////
		
		function welcome(socketID) {
			socket.emit('SETUP_STORE_ID', socket.id, userData[socketID].username, userData[socketID].ghost); //store's user's info on client side
			
			// io    = to everyone
			//socket = to specific user
			io.emit('LOG_CHAT_MSG', '<span style="color:'+ userData[socketID].color +'"><b>'+ userData[socketID].username +'</b> connected.</span><span style="float:right;" class="greenMsg">'+ Object.keys(userData).length +'</span>');
			socket.emit('LOG_CHAT_MSG', '<b>Welcome to '+ APP_NAME +' v'+ APP_VERSION +'!</b>');

			//socket.emit('LOG_CHAT_MSG', 'Consider joining <a href="https://discord.gg/szpznUj" target="_blank">Narcissa\'s Castle</a>, where game discussion happens.');
			socket.emit('LOG_CHAT_MSG', '<a href="/login/twitter">Click here</a> to login via <b>Twitter</b> to save your rank and get a real display name.');
			socket.emit('LOG_CHAT_MSG', 'Type "<b>/newcolor</b>" to get a new color when in the lobby.');
			
			if( !saveData ){
				socket.emit('LOG_CHAT_MSG', '<b>Development mode</b>: game results and rating changes will <span class="redMsg">not</span> be saved.');
			}
			
			var lobbyName = 'lobby'; //someday throwing all users into 1 lobby may be bad. could do #lobby2,3, #lobby1500elo etc
			
			io.to(lobbyName).emit('LOG_CHAT_MSG', '<span class="dimMsg">'+ userData[socketID].username +' joined '+ lobbyName +'.');
			
			// todo: stop socket from being able to send chats (spam) before some 'enabledChat' var being true for them
			socket.emit('SETUP_ENABLE_CHAT', userData[socketID].username);
			
			socket.emit('LOG_CHAT_MSG', '<div class="roomChange">joining '+ lobbyName +'</div>', true);
			socket.join(lobbyName); // joins the socket io room "lobby"
			userData[socketID].room = lobbyName;
			renderLobby(socket); // render lobby.
		}
				
		socket.on('disconnect', function(){
			if (userData[socket.id].room !== false) {
				io.emit('LOG_CHAT_MSG', '<span class="dimMsg">'+ userData[socket.id].username +' disconnected.</span><span class="redMsg" style="float:right">'+ (Object.keys(userData).length - 1) +'</span>');
				var gameID = userData[socket.id].room;
				checkForPlayerExit(gameID);
				updateLobby();
				console.log( userData[socket.id].username +' disconnected.' );
			}
			
			delete userData[socket.id];
			delete lastMessage[socket.id]; //todo: do flood control more elegantly
		});
		
		socket.on('error', function (err) {
			console.error('socket.io error:', err.stack);
			socket.emit('LOG_CHAT_MSG', '<span class="redMsg">socket error! Try reloading.</span>');
		});		
		
		/*
		socket.on('name chosen', function (name) { 
			userData[socket.id].username = name;
			userData[socket.id].color = assignColor();
			if (shortID(socket.id) != name) {
				socket.broadcast.emit('LOG_CHAT_MSG', '<span style="color: '+ userData[socket.id].color +';">' + shortID(socket.id) + '\'s name is <span style="font-weight: bold">' + userData[socket.id].username + '</span>.</span>' )
			}
			socket.emit('LOG_CHAT_MSG', '<span style="color: '+ userData[socket.id].color +';">Your name is <span style="font-weight:bold">' + userData[socket.id].username + '</span>.</span>' );
			io.to('lobby').emit('LOG_CHAT_MSG', '<span class="dimMsg">' + userData[socket.id].username + ' joined lobby.');
			socket.emit('make chat available', userData[socket.id].username);
			socket.join('lobby'); // joins the socket io room "lobby"
			userData[socket.id].room = 'lobby';
			updateLobby(); // render lobby.
			
			//db.push("/userData", userData);
			//db.push("/gameData", gameData);
			//var data = db.getData("/");
			//console.log(data);
		});
		*/
		
		var lastMessage = []; // hold timestamp of last sent message for basic flood control.
		// sends a chat message
		socket.on('CHAT_MSG', function(chatMessage) {
			if( !chatMessage ) return;             // do nothing on an empty msg
			if( chatMessage.length > 140 ) return; // max char length of msg
			
			// Flood Control (500ms)
			if( !lastMessage[socket.id] ) lastMessage[socket.id] = 0; // initialize it if first msg from user
			if( Date.now() - lastMessage[socket.id] < 500 ) return;   // 500ms minimum between messages
			lastMessage[socket.id] = Date.now();                      // update timestamp
			
			function isAdmin(twitterID) {
				if ( twitterID == 130360992 ) return true; // narcissa
				if ( twitterID == 30341147  ) return true; // chrstew
				return false;
			}
			
			
			// ex 1d4h30m22s 
			function getRelativeTime( startTime ){
				// get total seconds between the times
				var delta = Math.abs( startTime - Date.now() ) / 1000;

				// calculate (and subtract) whole days
				var days = Math.floor(delta / 86400);
				delta -= days * 86400;

				// calculate (and subtract) whole hours
				var hours = Math.floor(delta / 3600) % 24;
				delta -= hours * 3600;

				// calculate (and subtract) whole minutes
				var minutes = Math.floor(delta / 60) % 60;
				delta -= minutes * 60;

				// what's left is seconds
				var seconds = parseInt(delta % 60);  // in theory the modulus is not required
				
				var r = '';
				if( days    > 0 ) r+= days    +'d';
				if( hours   > 0 ) r+= hours   +'h';
				if( minutes > 0 ) r+= minutes +'m';
				if( seconds > 0 ) r+= seconds +'s';
				return r;
			}
			
			var room      = userData[socket.id].room;
			var username  = userData[socket.id].username;
			var color     = userData[socket.id].color;
			var twitterid = userData[socket.id].twitterid;
			
			function htmlEntities(str) { 
				return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
			}
			
			//parse emoji strings into emojis (ex :coffee: :heart:)
			var emoji = require('node-emoji');
			var chatMessage = emoji.emojify(chatMessage);
			
			chatMessage = htmlEntities(chatMessage);
			var splitMessage = chatMessage.split(' ');
			
			//check if we were sent a command
			switch( splitMessage[0] ){

				/*	
				case '/auth':
					if( isAdmin(twitterid) ){
						
						// this is old DB code...
						var newAccess = new AccessList({
							username: splitMessage[1]
						});
						newAccess.save(function (err, newAccess) {
							if (err) return console.error(err);
							twitterAuthList2.push(splitMessage[1]);
							socket.emit('LOG_CHAT_MSG', '<b>Access Granted to @' + splitMessage[1] + '</b>');
						});
						
					}
					break;
					
				case '/revoke':
					if( isAdmin(twitterid) ){
						socket.emit('LOG_CHAT_MSG', '<span class="redMsg">revoke not created yet</span>');
					}
					break;

				case '/pm':
					if( !splitMessage[2] ) return; //ensure there are at least 2 params after /pm [ex /pm user message]
					break;
				
				case '/stats':
					//
					break;
				*/

				
				case '/clear':
					socket.emit('LOG_CHAT_CLEAR');
					break;
					
					
				case '/users':
					socket.emit('LOG_CHAT_MSG', '<b>Users Online:</b> '+ Object.keys(userData).length );
					
					var userString = '';
					for( var user in userData ){
						if( userData[user].ghost ) continue; // don't show ghosts in user list
						userString += '<span style="color: '+ userData[user].color +'; font-weight:bold;">'+ userData[user].username +'</span>';
						userString += ' &nbsp; ('+ getRelativeTime( userData[user].connectTime ) +')\n<br>\n';
					}
					socket.emit('LOG_CHAT_MSG', userString );
					break;

					
				case '/newcolor':
					//if( room === 'lobby' && isAdmin(twitterid) ) newColor();
					if ( room === 'lobby' ) newColor();
					break;
				
				
				case '/debug':
					if( isAdmin(twitterid) ){
						socket.emit('console log', 'USER DATA:');
						
						for (var user in userData) {
							socket.emit('console log', user);
							socket.emit('console log', userData[user]);
						}
						
						socket.emit('console log', 'GAME PLAYER DATA:');
						for (var game in gameData) {
							socket.emit('console log', gameData[game].players);
						}
						socket.emit('LOG_CHAT_MSG', '<span class="dimMsg">Debug data acquired.</span>');
					}
					break;

					
				default:
					io.to(room).emit('LOG_CHAT_MSG', '<span style="color: '+ color +'; font-weight:bold;">'+ username +'</span><span class="dimMsg">:</span> '+ chatMessage);
					//console.log('<#'+ room +'> '+ username +': '+ chatMessage);
					chatLog(room, username, chatMessage);
					break;
				
				
			} // switch
		});
		
		socket.on('CHAT_COLOR_REROLL', function() {
			if (userData[socket.id].remainingRerolls <= 0) {
				socket.emit('LOG_CHAT_MSG', '<span class="redMsg">you have no color rerolls remaining.</span>');
				return;
			}
			
			userData[socket.id].remainingRerolls--;
			newColor();
			
			if (userData[socket.id].remainingRerolls <= 0) socket.emit('UI_NO_MORE_COLOR_REROLLS');
		});
		
		function newColor() {
			userData[socket.id].color = assignColor();
			var room = userData[socket.id].room;
			io.to(room).emit('LOG_CHAT_MSG', '<span style="color: '+ userData[socket.id].color +';"><b>'+ userData[socket.id].username +'</b> has a new color.</span>');
			socket.emit('update lobby welcome name color', userData[socket.id].color);
			
			if (saveData) {
				
				//currently anons have negative twitterid's
				if( userData[socket.id].twitterid < 0 ) return;
				
				db.sync(function(err) {
					if (err) throw err;
					User.find({ twitterID: userData[socket.id].twitterid }, function (err, users){
						if (err) throw err;
						if (users.length === 0) {
							console.log(userData[winner].username +' not found in  newColor().');
						} else {
							users[0].color = userData[socket.id].color;
							users[0].save(function (err) {
								if (err) throw err;
								updateLobby(); // render lobby cause leaderboard name color.. wow maybe I need a better way of coding this.
							});
						}
					});
				});
				
			}

			socket.emit('update lobby name color', userData[socket.id].color);
		}


		socket.on('GAME_PRACTICE_NEW', function() {
			
			if (userData[socket.id].room !== 'lobby') {
				socket.emit('LOG_CHAT_MSG', '<span class="redMsg">cannot create practice room unless in lobby.</span>');
				return;
			}
			
			var gameID = 'practice-'+ createGameID(); // randomly generate ID
			gameData[gameID] = {
				creator           : socket.id, // who made the game?
				title             : userData[socket.id].username +'\'s practice', // what's the name of the game?
				maxPlayers        : 1, // start with 1, up to 4 or maybe more later.
				totalGames        : 0, // how many rounds were played?
				remainingPlayers  : false,
				board             : [], // the board data, very important.
				initialBoard      : [], // need to make this
				moveList          : [], // need to make this
				rows              : 11, // default number
				cols              : 20, // default number
				players           : {}, // player data in the game (key is socket.id)
				specsList         : [], // array of socket.ids
				moveCount         : 0,  // number of turns
				timeLimit         : false, // default 1min. maybe use 'false' for no time limit.
				timerValue        : false, //
				gameTimer         : false, // this will be a function later on.
				gameType          : 'practice', // dunno if needed rn
				ratingsCalculated : false,  // true when finished calculating (W/D/L and rating)
				gameState         : 'open', // 'open', 'inprogress', 'gameover'
				tempBlock         : 'pass',
				blockList         : {},
				collisionMode     : { permanence: true }
			};
			
			practiceMode(gameID);
			
			socket.broadcast.to('lobby').emit('LOG_CHAT_MSG', '<span style="color: '+ userData[socket.id].color +'"; font-weight: bold;>'+ userData[socket.id].username +'</span> created a game.');
			//socket.broadcast.to('lobby').emit('LOG_CHAT_MSG', '<span class="dimMsg">'+ userData[socket.id].username +' created a practice room.</span>');
			
			setupGame(gameID);
			updateLobby();
		});
		
		// Hashes some random junk together. This is basically future proof.
		// If wanted we could have an ever incrementing nonce so no game (should) ever be the same
		function createGameID(){
			var input = ''+ Date.now() + rand(1,1000000);
			var hash = crypto.createHash('sha256').update(input).digest('hex');
			return hash.slice(0,32); // first half of the sha256 hash
		}
		
		socket.on('GAME_NEW', function(special) {
			
			if (userData[socket.id].room !== 'lobby') {
				socket.emit('LOG_CHAT_MSG', '<span class="redMsg">cannot create new game unless in lobby.</span>');
				return;
			}
			
			if( userData[socket.id].ghost){
				socket.emit('LOG_CHAT_MSG', '<span class="redMsg">ghost cannot create game.</span>');
				return;
			}
			
			var gameID = 'game-'+ createGameID(); // randomly generate ID
			if (special == 'random') gameID = 'random-'+ createGameID(); // randomly generate ID
			
			gameData[gameID] = {
				creator           : socket.id, // who made the game?
				title             : userData[socket.id].username + '\'s game', // what's the name of the game?
				maxPlayers        : 2, // start with 2, up to 4 or maybe more later.
				totalGames        : 0, // how many rounds were played?
				remainingPlayers  : false,
				board             : [], // the board data, very important.
				initialBoard      : [], // need to make this
				moveList          : [], // need to make this
				rows              : 11, // default number
				cols              : 20, // default number
				players           : {}, // player data in the game (key is socket.id)
				specsList         : [], // array of socket.ids
				moveCount         : 0, // number of turns
				timeLimit         : 60, // default 1min. maybe use 'false' for no time limit.
				timerValue        : 60,
				gameTimer         : false, // this will be a function later on.
				gameType          : 'new', // dunno if needed rn
				ratingsCalculated : false, // true when finished calculating (W/D/L and rating)
				noRematch         : false,
				gameState         : 'open', // 'open', 'inprogress', 'gameover'
				tempBlock         : 'pass',
				blockList         : {},
				collisionMode     : { permanence: true }
			};
			
			// the way I set up games right now, has the client pass in a special word "random" to determine what kind of game it should be (in this case, the only two options are standard and random.
			
			//standard (or exMode) here, sets up a board with no real terrain, in a specific configuration.
			// it includes 3 mines, 1 reclaim, a standardized sort of block loadout for each player.
			
			//random mode gives randomized terrain, start positions, and blocklist, within some limitations.
			//rematches in random mode will not shuffle the board, so a new game has to be created for a new board.
			
			// the issue is that...
			// there should be only one new game button
			// which leads to a screen DIFFERENT from how it is now,
			// a screen with options and settings, a game setup page
			
			if (special !== 'random') {
				exMode(gameID); // now with mines and reclaim!
			} else {
				randomMode(gameID); // random board;
			}
			
			//io.emit('connect audio'); // I used to use this for connect but I'm using it for new game now.
			io.emit('PLAY_AUDIO', 'connect'); // I used to use this for connect but I'm using it for new game now.
			
			io.emit('LOG_CHAT_MSG', '<span class="dimMsg">'+ userData[socket.id].username +' created a game.</span>');
			setupGame(gameID);
			updateLobby();
		});

		socket.on('GAME_JOIN', function(gameID, joinStatus) {
			if ( userData[socket.id].room != 'lobby' ) return;    // must be in lobby
			if ( !gameExists(undefined, gameID) ) return;         // can only join existing games
			if ( userData[socket.id].ghost ) joinStatus = 'spec'; // ghosts can only spectate games
			setupGame(gameID, joinStatus);
		});
		
		/*
		socket.on('classic mode', function() {
			var gameID = userData[socket.id].room;
			if (gameExists('creator')) {
				classicMode(gameID);
				io.to(gameID).emit('LOG_CHAT_MSG', '<span class="dimMsg">classic mode</span>');
				unreadyAll(gameID);
				io.to(gameID).emit('game preset', gameData[gameID].board, gameData[gameID].timeLimit, gameData[gameID].rows, gameData[gameID].cols, gameData[gameID].blockList, gameData[gameID].creator, gameData[gameID].collisionMode);
			}
		});

		socket.on('advanced mode', function() {
			var gameID = userData[socket.id].room;
			if (gameExists('creator')) {
				advancedMode(gameID);
				// How Deep Is Your Love by Calvin Harris & Disciples is a great song.
				io.to(gameID).emit('LOG_CHAT_MSG', '<span class="dimMsg">advanced mode</span>');
				unreadyAll(gameID);
				io.to(gameID).emit('game preset', gameData[gameID].board, gameData[gameID].timeLimit, gameData[gameID].rows, gameData[gameID].cols, gameData[gameID].blockList, gameData[gameID].creator, gameData[gameID].collisionMode);
			}
		});
		
		socket.on('done editing', function() {
			var gameID = userData[socket.id].room;
			if (gameExists('creator')) {
				socket.emit('GAME_SETUP', 
					gameID,
					'creator',
					gameData[gameID].title,
					gameData[gameID].rows, 
					gameData[gameID].cols, 
					gameData[gameID].board, 
					gameData[gameID].players,
					gameData[gameID].gameState,
					gameData[gameID].blockList,
					gameData[gameID].timeLimit,
					gameData[gameID].collisionMode
				);
			}
		});
		
		socket.on('randomize', function() {
			var gameID = userData[socket.id].room;
			if (gameExists('creator')) {
				if (gameData[gameID].maxPlayers == 2) {
					
					randomMode(gameID);
					io.to(gameID).emit('LOG_CHAT_MSG', '<span class="dimMsg">board randomly generated.</span>');
					unreadyAll(gameID);
					io.to(gameID).emit('game preset', gameData[gameID].board, gameData[gameID].timeLimit, gameData[gameID].rows, gameData[gameID].cols, gameData[gameID].blockList, gameData[gameID].creator, gameData[gameID].collisionMode);
				} else {
					// sorry this was only built for 2 players.
					io.to(gameID).emit('LOG_CHAT_MSG', 'randomization function only works with 2 player games.');
				}
			}
		});
		*/
		
		// SOCKET.IO
		////////////////////////////////////////////////////////////
		
		function setupGame(gameID, passedStatus) {
			if (typeof gameData[gameID] !== 'undefined') {
				socket.leave('lobby');
				if (passedStatus === 'spec') {
					socket.emit('LOG_CHAT_MSG', '<div class="roomChange">spectating game</div>', true);
				} else {
					if (gameData[gameID].creator == socket.id) {
						socket.emit('LOG_CHAT_MSG', '<div class="roomChange">creating game</div>', true);
					} else {
						socket.emit('LOG_CHAT_MSG', '<div class="roomChange">joining game</div>', true);
					}
				}
				
				var joinStatus = 'spectator'; // by default you're a specatator
				var displayBoard = gameData[gameID].board;
				
				if (passedStatus !== 'spec') {
					if (gameData[gameID].gameState == 'open') {
						
						// if the game is open, check if there are vacant slots
						var playerCount = Object.keys(gameData[gameID].players).length;
						if (playerCount < gameData[gameID].maxPlayers) {
							setPlayer(gameID, socket.id);
							
							// check if this is the creator of the game
							if (gameData[gameID].creator == socket.id) {
								joinStatus = 'creator';
							} else {
								joinStatus = 'player';
								var playerCount = Object.keys(gameData[gameID].players).length;
								/*
								if (playerCount < gameData[gameID].maxPlayers) {
									gameData[gameID].gameState == 'full';
								}
								*/
							}
						}
					}
					
					// log
					if (joinStatus !== 'creator') {
						io.to('lobby').emit('LOG_CHAT_MSG', '<span style="color:'+ userData[socket.id].color +';">'+ userData[socket.id].username +'</span> joined '+ gameData[gameID].title +'.');
					}
					
				} else {
					gameData[gameID].specsList.push(socket.id);
					if (gameData[gameID].gameState == 'inprogress') {
						// spec board.
						displayBoard = JSON.parse(JSON.stringify(gameData[gameID].board));
						for (var i = 0; i < displayBoard.length; i++) {
							if (displayBoard[i].type == 'mine') hiddenInformation(displayBoard[i]);
						}
					}
				}
				
				var color = "#8474a4";
				if (typeof gameData[gameID].players[socket.id] != 'undefined') {
					color = gameData[gameID].players[socket.id].color;
				}
				
				joinMsg(joinStatus, color, userData[socket.id].username);
				function joinMsg(joinStatus, color, username) {
					io.to(gameID).emit('LOG_CHAT_MSG', '<span style="color: '+ color +'">'+ username +' joined as '+ joinStatus +'.</span>');
					if (joinStatus !== 'spectator') {
						io.to(gameID).emit('add to heading', socket.id, userData[socket.id].username, gameData[gameID].players[socket.id].color, gameData[gameID].players[socket.id].elo);
						io.to(gameID).emit('UI_BOARD_RENDER', gameData[gameID].board);
					}
				}
				
				socket.join(gameID);
				userData[socket.id].room = gameID;
				
				//todo: return a single option instead of the gameData subitems
				socket.emit('GAME_SETUP', 
					gameID,
					joinStatus,
					gameData[gameID].title,
					gameData[gameID].rows, 
					gameData[gameID].cols, 
					displayBoard, 
					gameData[gameID].players,
					gameData[gameID].gameState,
					gameData[gameID].blockList,
					gameData[gameID].timeLimit,
					gameData[gameID].collisionMode,
					gameData[gameID].moveCount,
					gameData[gameID].timerValue,
					gameData[gameID].gameType
				);
				
				if (gameData[gameID].gameState == 'gameover') gameOver(gameID);
				
				updateLobby();
				
				io.to(gameID).emit('update user list', userList(gameID)); // todo
			}
		}
		
		function userList(gameID) {
			var userList = {}; // todo
		}
		
		function joinMsg(gameID, joinStatus, color, username) {
			io.to(gameID).emit('LOG_CHAT_MSG', '<span style="color: '+ color +'">'+ username +' is '+ color +'.</span>');
		}
		
		function setPlayer(gameID, playerID) {
			
			gameData[gameID].players[playerID] = {
				username       : userData[socket.id].username,
				displayElo     : returnDisplayElo(playerID),
				winner         : false, 
				winPath        : [], 
				hasMoved       : false,
				onStandby      : false,
				offeredDraw    : false,
				rematchOffered : false,
				ready          : false,
				forfeit        : false,
				disconnected   : false,
				baseX          : false,
				baseY          : false,
				color          : false,
				blockList      : {},
				wins           : 0,
				draws          : 0,
				losses         : 0
			};
			
			// assign player color to game
			gameData[gameID].players[playerID].color = userData[playerID].color;
			
			
			// this color brightness fix sucks too bad to use, need to do something different. disabling it for now.
			/*
			// it's time to figure out if player colors are too close to eachother...
			var playerColors = [];
			var playerIDs = [];
			for (var playerID in gameData[gameID].players) {
				playerColors.push(gameData[gameID].players[playerID].color);
				playerIDs.push(playerID);
			}
			if (playerColors.length == 2) {
				// somewhat problematic for 4 player games.
				// i won't worry about it at the moment though.
				if (hexColorDelta(playerColors[0], playerColors[1]) > 0.95) {
					// if the difference between colors is small (0.2)
					// then brighten or darken one of them...
					gameData[gameID].players[playerIDs[1]].color = increase_brightness(playerColors[1], 40); // inc brightness by 40%
					//io.to(gameID).emit('LOG_CHAT_MSG', '<span class="dimMsg">player colors nearly match; brightened ' + userData[playerID].username + '\'s color.</span>');
				}
			}
			*/
			
			var bases = [];
			for (var i = 0; i < gameData[gameID].board.length; i++) {
				if (gameData[gameID].board[i].type == 'base') bases.push(i); //  push base position into bases array
			}
			
			if (gameData[gameID].creator == socket.id) {
				// find the base with a left-most x-position and use that for creator slot
				if (gameData[gameID].board[bases[0]].x < gameData[gameID].board[bases[1]].x) {
					var pos = bases[0];
				} else {
					var pos = bases[1];
				}
				
			} else {
				// find the base with a right-most position and use that for joining player
				if (gameData[gameID].board[bases[0]].x < gameData[gameID].board[bases[1]].x) {
					var pos = bases[1];
				} else {
					var pos = bases[0];
				}
				
			}
			
			var x = gameData[gameID].board[pos].x + 1;
			var y = gameData[gameID].board[pos].y + 1;
			
			gameData[gameID].board[pos].history[0] = { 
				turn  : 0,
				cause : 'source', 
				playerColor: gameData[gameID].players[socket.id].color,
				playerDisplayName: userData[socket.id].username
			};
			
			gameData[gameID].players[socket.id].baseX = x;
			gameData[gameID].players[socket.id].baseY = y;
			gameData[gameID].board[pos].possession.push(socket.id); // ??
			gameData[gameID].board[pos].possessionDisplayName = userData[socket.id].username;
			gameData[gameID].board[pos].color = gameData[gameID].players[socket.id].color;
		}
		
		/*
		socket.on('new color', function (color) {
			var gameID = userData[socket.id].room;
			if (typeof gameData[gameID] != 'undefined') {
				if (gameData[gameID].gameState == 'open') {
					if (typeof gameData[gameID].players[socket.id] == 'undefined') {
						setPlayer();
						io.to(gameID).emit('LOG_CHAT_MSG', '<span style="color: '+ color +'">'+ userData[socket.id].username +' is playing.</span>');
					} else {
						io.to(gameID).emit('LOG_CHAT_MSG', '<span style="color: '+ color +'">' + userData[socket.id].username +' changed colors.</span>');
					}
					gameData[gameID].players[socket.id].color = color;
					
					for (var i = 0; i < gameData[gameID].board.length; i++) {
						if (gameData[gameID].board[i].possession.length == 1) {
							if (gameData[gameID].board[i].possession[0] == socket.id) {
								gameData[gameID].board[i].color = color;
							}
						}
					}
					
					io.to(gameID).emit('update colors', gameData[gameID].players, baseColors, gameData[gameID].maxPlayers, gameData[gameID].board);
				} else {
					io.emit('LOG_CHAT_MSG', '<span class="redMsg">gameState not open in <i>new color</i></span>');
				}
			} else {
				io.emit('LOG_CHAT_MSG', '<span class="redMsg">gameData['+ gameID +'] undefined in <i>new color</i></span>');
			}
		});
		
		socket.on('choose to spectate', function() {
			var gameID = userData[socket.id].room;
			if (gameExists()) {
				if (gameData[gameID].gameState == 'open') {
					unready(gameID, socket.id);
					delete gameData[gameID].players[socket.id];
					io.to(gameID).emit('LOG_CHAT_MSG', '<span class="dimMsg">' + userData[socket.id].username + ' is spectating.');
					//io.to(gameID).emit('update colors', gameData[gameID].players, baseColors, gameData[gameID].maxPlayers, gameData[gameID].board);
				}
			}
		});

		socket.on('time limit setting', function(moreOrLess) {
			var gameID = userData[socket.id].room;
			if (gameExists('creator')) {
				var problem = false;
				if (moreOrLess === 'more') {
					if (gameData[gameID].timeLimit >= 100) {
						gameData[gameID].timeLimit = false;
					} else if (gameData[gameID].timeLimit == false) {
						gameData[gameID].timeLimit = 10;
					} else {
						gameData[gameID].timeLimit += 5;
					}
				} else if (moreOrLess === 'less') {
					if (gameData[gameID].timeLimit == false) {
						gameData[gameID].timeLimit = 100;
					} else if (gameData[gameID].timeLimit <= 10) {
						gameData[gameID].timeLimit = false;
					} else {
						gameData[gameID].timeLimit -= 5;
					}
				} else if (moreOrLess == 'infin') {
					if (gameData[gameID].timeLimit == false) {
						gameData[gameID].timeLimit = 60; 
					} else {
						gameData[gameID].timeLimit = false;
					}
				} else {
					problem = true;
				}
				if (problem) {
					socket.emit('LOG_CHAT_MSG', '<span class="redMsg">passed incorrect value to <i>time limit setting</i>.</span>');
				} else {
					gameData[gameID].gameType = 'custom';
					gameData[gameID].timerValue = gameData[gameID].timeLimit;
					unreadyAll(gameID);
					io.to(gameID).emit('time limit update', gameData[gameID].timeLimit);
				}
			}
		});
		
		socket.on('collision setting', function(setting) {
			var gameID = userData[socket.id].room;
			if (gameExists('creator')) {
				var problem = false;
				if ((setting === 3) || (setting === 4) || (setting === 5)) {
					// this code makes me nervous.
					// I'm using both true and 1 as valid, different values.
					// it's a bit scary to me.
					gameData[gameID].collisionMode.permanence = setting;
				} else if (setting === "Permanent") {
					gameData[gameID].collisionMode.permanence = true;
				} else {
					problem = true;
				}
				if (problem) {
					io.to(gameID).emit('LOG_CHAT_MSG', '<span class="redMsg">passed incorrect value to <i>collision setting</i></span>');
				} else {
					unreadyAll(gameID);
					io.to(gameID).emit('collision update', gameData[gameID].collisionMode);
					updateLobby(); // render lobby because I now show this data in lobby.
				}
			}
		});
		
		socket.on('board edit', function(x, y, blockType) {
			var gameID = userData[socket.id].room;
			if (gameExists('creator')) {
				updateBlock(gameID, x, y, blockType);
				if (gameData[gameID].gameType !== 'custom') {
					gameData[gameID].gameType = 'custom';
				}
				io.to(gameID).emit('UI_BOARD_RENDER', gameData[gameID].board);
			}
		});
		
		socket.on('blocklist update', function(blockType, active) {
			var gameID = userData[socket.id].room;
			if (gameExists('creator')) {
				if (active) {
					if (typeof gameData[gameID].blockList[blockType] === 'undefined') {
						gameData[gameID].blockList[blockType] = { ammo: false }
					}
					io.to(gameID).emit('LOG_CHAT_MSG', '<span class="dimMsg">' + userData[socket.id].username + ' enabled ' + blockType + '.</span>');
				} else {
					delete gameData[gameID].blockList[blockType];
					io.to(gameID).emit('LOG_CHAT_MSG', '<span class="dimMsg">' + userData[socket.id].username + ' disabled ' + blockType + '.</span>');
				}
				unreadyAll(gameID);
				gameData[gameID].gameType = 'custom';
				//io.to(gameID).emit('blocklist updated', blockType, active, false); // also send ammo later.
				socket.broadcast.to(gameID).emit('build menu', gameData[gameID].blockList);
			}
		});
		
		socket.on('ammo update', function(blockType, ammoAmount) {
			var gameID = userData[socket.id].room;
			if (gameExists('creator')) {
				function validAmmo() {
					if (ammoAmount === '&infin;') {
						ammoAmount = false;
						return true;
					} else {
						if (ammoAmount >= 1 && ammoAmount <= 20) return true;
						return false;
					}
				}
				
				if (validAmmo()) {
					gameData[gameID].blockList[blockType].ammo = ammoAmount; //crash
					io.to(gameID).emit('LOG_CHAT_MSG', '<span class="dimMsg">' + blockType + ' ammo = ' + ammoAmount + '.</span>');
					unreadyAll(gameID);
					gameData[gameID].gameType = 'custom';
					// io.to(gameID).emit('update ammo or w/e');
					socket.emit('update creator ammo', blockType, ammoAmount);
					socket.broadcast.to(gameID).emit('build menu', gameData[gameID].blockList);
				} else {
					io.to(gameID).emit('LOG_CHAT_MSG', '<span class="redMsg">invalid amount!</span>');
				}
			}
		});
		
		socket.on('update board size', function(rows, cols) {
			var gameID = userData[socket.id].room;
			if (gameExists()) {
				if (gameData[gameID].creator == socket.id) {
					gameData[gameID].rows = rows;
					gameData[gameID].cols = cols;
					socket.broadcast.to(gameID).emit('rebuild board', rows, cols);
				} else {
					socket.emit('LOG_CHAT_MSG', '<span class="redMsg">you\'re not the creator!</span>');
				}
			}
		});
		*/
		
		function gameExists(client, gameID) {
			if (typeof gameID === 'undefined') var gameID = userData[socket.id].room;
			
			if (typeof gameData[gameID] == 'undefined') {
				socket.emit('LOG_CHAT_MSG', '<span class="redMsg">not in a valid game</span>');
				return false;
			}
				
			if (typeof client !== 'undefined' && client === 'creator') {
				if (gameData[gameID].creator === socket.id) return true;
				
				socket.emit('LOG_CHAT_MSG', '<span class="redMsg">not the creator</span>');
				return false;
			}
			
			return true;
		}
		
		socket.on('GAME_READY', function() {
			var gameID = userData[socket.id].room;
			if (gameExists() && (typeof gameData[gameID].players[socket.id] !== 'undefined')) {
				if (gameData[gameID].players[socket.id].ready !== true) {
					var user = userData[socket.id].username;
					
					if (gameData[gameID].gameType !== 'practice') {
						io.to(gameID).emit('LOG_CHAT_MSG', '<span style="color:'+ gameData[gameID].players[socket.id].color +';">'+ user +' is ready!</span>');
					}
					
					gameData[gameID].players[socket.id].ready = true;
					
					optionsDetection2(gameID, gameData[gameID].players[socket.id].baseX, gameData[gameID].players[socket.id].baseY, socket.id);
					//optionsDetection(gameID, x, y, socket.id);

					//io.to(gameID).emit('add to heading', socket.id, userData[socket.id].username, gameData[gameID].players[socket.id].color, x);
					io.to(gameID).emit('UI_BOARD_RENDER', gameData[gameID].board);
					
					if (allPlayersReady(gameID)) {
						// clone object... dangerous if the obj has methods or date, etc. but it works here imo
						gameData[gameID].initialBoard = JSON.parse(JSON.stringify(gameData[gameID].board));
						startGame(gameID);
					}
				}
			}
		});
		
		socket.on('GAME_NOT_READY', function() {
			var gameID = userData[socket.id].room;
			if ((typeof gameData[gameID] !== 'undefined') && (typeof gameData[gameID].players[socket.id] !== 'undefined')) {
				if (unready(gameID, socket.id)) {
					io.to(gameID).emit('UI_BOARD_RENDER', gameData[gameID].board);
				}
			} else {
				socket.emit('LOG_CHAT_MSG', '<span class="redMsg">undefined in <i>unready</i></span>');
			}
		});
		
		function youArePlaying(players) {
			for (var id in players) { if (id == socket.id) return true; }
			return false; 
		}
		
		socket.on('GAME_MOVE_ATTEMPT', function(x, y, blockType, moveCount){ 
			// x,y was never checked as valid, fake shit can pass into here and mess everything up.
			
			var gameID = userData[socket.id].room;
			// obtain gameID
			
			// if the game exists
			if (typeof gameData[gameID] == 'undefined') {
				socket.emit('LOG_CHAT_MSG', '<span class="redMsg">undefined game in <i>attempt move</i></span>');
				return;
			}
			
			if ((youArePlaying(gameData[gameID].players)) && (gameData[gameID].gameState == 'inprogress')) {
				// good. todo: simplify above if statement / make two slashing conditions
			} else {
				socket.emit('LOG_CHAT_MSG', '<span class="redMsg">spectator cannot make moves</span>');
				return;
			}
			
			var pos = get_pos(gameID, x, y);
			// get move position for the board array
			
			try {
				blockType = validateMove(gameID, blockType, pos, socket.id);
				// validateMove returns false if invalid.
			} catch(err) {
				blockType = false;
			}
			
			if (blockType !== false && moveCount == gameData[gameID].moveCount) {
				// good. todo: simplify above if statement / make two slashing conditions
				// make sure the move is valid
			} else {
				// invalid move.
				socket.emit('LOG_CHAT_MSG', '<span class="redMsg">invalid move</span>');
				return;
			}				
				
			gameData[gameID].players[socket.id].hasMoved = true;
			if (allPlayersMoved(gameData[gameID].players)) {
				var tempBlock2 = [x,y,blockType,socket.id];
				
				// this shit is a problem for 4 player mode!
				performTurn(gameID, gameData[gameID].tempBlock, tempBlock2);
				
			} else {
				// still waiting for other players
				gameData[gameID].tempBlock = [x,y,blockType,socket.id]; // store data temporarily
				gameData[gameID].players[socket.id].onStandby = true;
				socket.broadcast.to(gameID).emit('LOG_CHAT_MSG', '<span class="waitMsg blinkText">'+ gameData[gameID].players[socket.id].username +' has moved.'); // let the opponent know
				
				var opponentList = [];
				for (var player in gameData[gameID].players) {
					if (socket.id != player) opponentList.push(player);
				}
				
				if (opponentList.length == 1) {
					socket.emit('LOG_CHAT_MSG', '<span class="waitMsg blinkText">Waiting for '+ gameData[gameID].players[opponentList[0]].username +'.</span>');
				} else {
					socket.emit('LOG_CHAT_MSG', '<span class="waitMsg blinkText">Waiting for opponents.</span>');
				}
			}
		});

		function checkForPlayerExit(gameID) {
			if (typeof gameData[gameID] !== 'undefined') {
				
				// remove from specs list if found there.
				for (var j = 0; j < gameData[gameID].specsList.length; j++) {
					if (gameData[gameID].specsList[j] == socket.id) {
						gameData[gameID].specsList.splice(j,1);
					}
				}
				
				if (gameData[gameID].gameState == 'open') {
					if (gameData[gameID].creator == socket.id) {
						// creator left an open game, so kill the game.
						socket.broadcast.to(gameID).emit('GAME_KILL');
						delete gameData[gameID]; // remove game object
						updateLobby(); // player spot opened?
						
					} else {
						// player left an open game, so remove them.
						for (var playerID in gameData[gameID].players) {
							if (playerID == socket.id) {
								wipePossession(gameID, playerID);
								delete gameData[gameID].players[playerID];
								updateLobby(); // player spot opened?
								io.to(gameID).emit('LOG_CHAT_MSG', '<span class="dimMsg">removed '+ userData[socket.id].username +' as player.</span>');
								io.to(gameID).emit('remove player heading');
								io.to(gameID).emit('UI_BOARD_RENDER', gameData[gameID].board);
							}
						}
					}
				} else if (gameData[gameID].gameState == 'inprogress') {
					for (var playerID in gameData[gameID].players) {
						if (playerID == socket.id) {
							// player left an in-progress game, so they lose.
							wipePossession(gameID, playerID);
							gameData[gameID].players[playerID].disconnected = true;
							gameData[gameID].remainingPlayers--;
							io.to(gameID).emit('UI_BOARD_RENDER', gameData[gameID].board);
							if (gameData[gameID].remainingPlayers <= 1) {
								for (var playerID in gameData[gameID].players) {
									if ((gameData[gameID].players[playerID].disconnected) || (gameData[gameID].players[playerID].forfeit)) {
										// this player is not the winner
									} else {
										gameData[gameID].players[playerID].winner = true;
									}
								}
								gameOver(gameID);
								//io.to(gameID).emit('game over', winner, 'dc');
							}
						}
					}
					
				} else if (gameData[gameID].gameState == 'gameover') {
					for (var playerID in gameData[gameID].players) {
						if (playerID == socket.id) {
							io.to(gameID).emit('remove rematch button');
							gameData[gameID].noRematch = true;
						}
					}
				}
			}
		}
		
		socket.on('GAME_EXIT_TO_LOBBY', function() {
			var gameID = userData[socket.id].room;
			
			if (gameID == 'lobby') {
				socket.emit('LOG_CHAT_MSG', '<span class="redMsg">You are already in the lobby!</span>');
				return;
			}
			
			socket.leave(gameID);
			
			var lobbyName = 'lobby'; // may do multiple lobbies in the future
			io.to(lobbyName).emit('LOG_CHAT_MSG', '<span class="dimMsg">'+ userData[socket.id].username +' joined lobby.');
			socket.emit('LOG_CHAT_MSG', '<div class="roomChange">joining '+ lobbyName +'</div>', true);
			socket.join(lobbyName);
			userData[socket.id].room = lobbyName;
			io.to(gameID).emit('LOG_CHAT_MSG', '<span class="dimMsg">'+ userData[socket.id].username +' left.</span>' );
			checkForPlayerExit(gameID);
			renderLobby(socket);
		});
		
		socket.on('GAME_PRACTICE_RESET', function() {
			var gameID = userData[socket.id].room;
			if (gameExists('creator')) {
				if (gameData[gameID].gameType == 'practice') {
					gameData[gameID].board = JSON.parse(JSON.stringify(gameData[gameID].initialBoard));
					
					for (var player in gameData[gameID].players) {
						gameData[gameID].players[player].blockList    = JSON.parse(JSON.stringify(gameData[gameID].blockList)); //todo, simplify the J
						gameData[gameID].players[player].winner       = false;
						gameData[gameID].players[player].winPath      = [];
						gameData[gameID].players[player].hasMoved     = false;
						gameData[gameID].players[player].onStandby    = false;
						gameData[gameID].players[player].offeredDraw  = false;
						gameData[gameID].players[player].disconnected = false;
						gameData[gameID].players[player].forfeit      = false;
					}
					
					io.to(gameID).emit('setup rematch', gameData[gameID].blockList);
					io.to(gameID).emit('LOG_CHAT_MSG', '<span class="dimMsg">Reset.</span>');
					io.to(gameID).emit('UI_BOARD_RENDER', gameData[gameID].board);
					startGame(gameID);
				}
			}
		});
		
		// REMATCH
		socket.on('yes rematch', function() {
			var gameID = userData[socket.id].room;
			
			if ( !gameExists() ) return; //game does not exist
			
			if ( gameData[gameID].gameState != 'gameover' && gameData[gameID].noRematch != false ) {
				socket.emit('LOG_CHAT_MSG', '<span class="redMsg">rematch not possible in <i>offer rematch</i>!</span>');
				return;
			}
				
			////////////////////
			// todo: improve this. this is to stop someone not in a match accepting a rematch(?)
			var hacking = true;
			for (var player in gameData[gameID].players) {
				if (player == socket.id) hacking = false;
			}
			
			if (hacking) {
				socket.emit('LOG_CHAT_MSG', '<span class="redMsg">No hacking!</span>');
				return;
			}
			////////////////////
			
			gameData[gameID].players[socket.id].rematchOffered = true;
			var numPlayers = 0;
			var numYesRematch = 0;
			for (var player in gameData[gameID].players) {
				numPlayers++;
				if (gameData[gameID].players[player].rematchOffered == true) {
					numYesRematch++;
				}
			}
			
			if (numPlayers !== numYesRematch) {
			
				socket.broadcast.to(gameID).emit('rematch offered');
				io.to(gameID).emit('LOG_CHAT_MSG', '<span class="dimMsg">'+ userData[socket.id].username +' offered a rematch.</span>');
			
			} else {
				// REMATCH INITIATED!!
				gameData[gameID].board = JSON.parse(JSON.stringify(gameData[gameID].initialBoard));
				gameData[gameID].ratingsCalculated = false;
				
				var over1000 = 0;
				var creatorElo = returnDisplayElo(gameData[gameID].creator);
				var playerElo = creatorElo; // initially set this to creatorElo but change it if it's found to be different.
				for (var player in gameData[gameID].players) {
					gameData[gameID].players[player].blockList = JSON.parse(JSON.stringify(gameData[gameID].blockList));
					gameData[gameID].players[player].winner = false;
					gameData[gameID].players[player].winPath = [];
					gameData[gameID].players[player].hasMoved = false;
					gameData[gameID].players[player].onStandby = false;
					gameData[gameID].players[player].offeredDraw = false;
					gameData[gameID].players[player].rematchOffered = false;
					gameData[gameID].players[player].disconnected = false;
					gameData[gameID].players[player].forfeit = false;
					
					// if it's different, set it to the other player's elo.
					if (userData[player].elo !== creatorElo) {
						playerElo = returnDisplayElo(player);
					}
					
					/*
					if (userData[player].elo > 1000) {
						over1000++;
					}
					*/
				}
				
				gameData[gameID].totalGames++;
				
				var iceBoard = false;
				
				/*
				if ((gameData[gameID].totalGames >= 4) && (over1000 == 2)) {
					// if at least 4 games were played, and both players are over 1000 elo
					if (rand(1,7) == 7) {
						// if 1/7
						console.log('ice board');
						iceBoard = true;
						for (var i = 0; i < (gameData[gameID].board.length / 2); i++) {
							if (gameData[gameID].board[i].type == 'blank' && (rand(1,15) == 15)) {
								gameData[gameID].board[i].type = 'ice';
								gameData[gameID].board[(gameData[gameID].board.length - i - 1)].type = 'ice';
							}
						}
						
						// clear surrounding. this shit sucks for different board sizes just FYI!!!
						updateBlock(gameID, 4, 5, "blank");
						updateBlock(gameID, 5, 5, "blank");
						updateBlock(gameID, 6, 5, "blank");
						updateBlock(gameID, 4, 6, "blank");
						updateBlock(gameID, 6, 6, "blank");
						updateBlock(gameID, 4, 7, "blank");
						updateBlock(gameID, 5, 7, "blank");
						updateBlock(gameID, 6, 7, "blank");
						
						updateBlock(gameID, 16, 5, "blank");
						updateBlock(gameID, 17, 5, "blank");
						updateBlock(gameID, 18, 5, "blank");
						updateBlock(gameID, 16, 6, "blank");
						updateBlock(gameID, 18, 6, "blank");
						updateBlock(gameID, 16, 7, "blank");
						updateBlock(gameID, 17, 7, "blank");
						updateBlock(gameID, 18, 7, "blank");
					}
				}
				*/
				
				io.to(gameID).emit('setup rematch', gameData[gameID].blockList, creatorElo, playerElo);
				io.to(gameID).emit('LOG_CHAT_MSG', '<span class="dimMsg">Rematch initiated</span>');
				
				if (iceBoard) io.to(gameID).emit('LOG_CHAT_MSG', '<span class="coldWeather">Cold weather!</span>');
				
				io.to(gameID).emit('UI_BOARD_RENDER', gameData[gameID].board);
				startGame(gameID);
			}
		});

		socket.on('GAME_FORFEIT', function() {
			var gameID = userData[socket.id].room;
			
			if ( !gameExists() ) return;
			
			if ( !youArePlaying(gameData[gameID].players) ) {
				socket.emit('LOG_CHAT_MSG', '<span class="redMsg">spectators cannot forfeit</span>'); 
				return;
			}
			
			wipePossession(gameID, socket.id);
			
			gameData[gameID].remainingPlayers--;
			gameData[gameID].players[socket.id].forfeit = true;
			
			io.to(gameID).emit('UI_BOARD_RENDER', gameData[gameID].board);
			
			if ( gameData[gameID].remainingPlayers <= 1 ) {
				var winner = false;
				for (var playerID in gameData[gameID].players) {
					if ((gameData[gameID].players[playerID].disconnected) || (gameData[gameID].players[playerID].forfeit)) {
						// this player is not the winner
					} else {
						gameData[gameID].players[playerID].winner = true;
					}
				}
				gameOver(gameID);
			}
		});
		
		/*
		socket.on('offer draw', function(gameID) {
			var whichPlayer = getPlayerNumber(gameID, socket.id);
			if ((whichPlayer == 1) || (whichPlayer == 2)) {
				gameData[gameID].playerOfferedDraw = whichPlayer;
				socket.broadcast.to(gameID).emit('draw offered', gameID);
			}
		});
		socket.on('draw accepted', function(gameID) {
			
			var whichPlayer = getPlayerNumber(gameID, socket.id);
			if (whichPlayer == 1 && gameData[gameID].playerOfferedDraw == 2) {
				drawGameCleanup();
				socket.broadcast.to(gameID).emit('game over', 3, 'drawAccepted');
			} else if (whichPlayer == 2 && gameData[gameID].playerOfferedDraw == 1) {
				drawGameCleanup();
				socket.broadcast.to(gameID).emit('game over', 3, 'drawAccepted');
			} else {
				socket.emit('LOG_CHAT_MSG', '<span class="redMsg">draw accept failed</span>');
			}
			
			function drawGameCleanup() {
				var playerList = [];
				for (var playerID in gameData[gameID].players) {
					if ((gameData[gameID].players[playerID].disconnected == false) && (gameData[gameID].players[playerID].forfeit == false)) {
						gameData[gameID].players[playerID].winner = true;
						playerList.push[playerID]
					}
				}
				for (var i = 0; i < gameData[gameID].board.length; i++) {
					if (gameData[gameID].board[i].possession.length != 0) {
						gameData[gameID].board[i].possession = playerList;
					}
				}
				io.to(gameID).emit('UI_BOARD_RENDER', gameData[gameID].board);
			}
		});
		socket.on('title update', function(title) {
			var gameID = userData[socket.id].room;
			if (gameData[gameID].creator == socket.id) {
				gameData[gameID].title = title;
				//updateLobby();
			} else {
				socket.emit('LOG_CHAT_MSG', '<span class="redMsg">you\'re not the creator!</span>');
			}
		});
		*/
	});
	
	function rand(min, max) { return parseInt(Math.random() * (max-min+1), 10) + min; }
	
	// COLORS
	function assignColor() {
		var randomHue        = rand(1, 360);
		var randomSaturation = rand(40, 75);
		var lightnessBonus   = rand(-5, 5); // this is hacky but w/e.
		
		if ((randomHue > 50) && (randomHue < 190)) {
			// when in the green/cyan range, decrease brightness a bit.
			lightnessBonus = rand(-20, -10);
		} else if ((randomHue > 210) && (randomHue < 300)) {
			// in the blue/purple range, increase brightness a bit.
			lightnessBonus = rand(10, 20);
		}
		
		var randomLightness = (rand(50, 75) + lightnessBonus);
		//return hsl(randomHue,randomSaturation,randomLightness);    // hsl-to-hex node module
		return hslToHex(randomHue,randomSaturation,randomLightness); // internal function
	}
	
	//finds the difference between two colors.
	function hexColorDelta(hex1, hex2) {
		hex1 = hex1.replace(/^\s*#|\s*$/g, '');
		hex2 = hex2.replace(/^\s*#|\s*$/g, '');
		
		// get red/green/blue int values of hex1
		var r1 = parseInt(hex1.substring(0, 2), 16);
		var g1 = parseInt(hex1.substring(2, 4), 16);
		var b1 = parseInt(hex1.substring(4, 6), 16);
		
		// get red/green/blue int values of hex2
		var r2 = parseInt(hex2.substring(0, 2), 16);
		var g2 = parseInt(hex2.substring(2, 4), 16);
		var b2 = parseInt(hex2.substring(4, 6), 16);
		
		// calculate differences between reds, greens and blues
		var r = 255 - Math.abs(r1 - r2);
		var g = 255 - Math.abs(g1 - g2);
		var b = 255 - Math.abs(b1 - b2);
		
		// limit differences between 0 and 1
		r /= 255;
		g /= 255;
		b /= 255;
		
		return ( (r + g + b) / 3); // 0 means opposite colors, 1 means same colors
	}
	
	function increase_brightness(hex, percent){
		hex = hex.replace(/^\s*#|\s*$/g, ''); // strip the leading # if it's there

		// convert 3 char codes --> 6, e.g. `E0F` --> `EE00FF`
		if (hex.length == 3) hex = hex.replace(/(.)/g, '$1$1');
		
		var r = parseInt(hex.substr(0, 2), 16);
		var	g = parseInt(hex.substr(2, 2), 16);
		var	b = parseInt(hex.substr(4, 2), 16);

		var hexColor = '#';
		hexColor += ((0|(1<<8) + r + (256 - r) * percent / 100).toString(16)).substr(1);
		hexColor += ((0|(1<<8) + g + (256 - g) * percent / 100).toString(16)).substr(1);
		hexColor += ((0|(1<<8) + b + (256 - b) * percent / 100).toString(16)).substr(1);
		return hexColor;
	}
	
	//this was to remove the hsl-to-hex node dependency.
	//todo: put all colour functions into a seperate class
	function hslToHex(h, s, l){
		h /= 360;
		s /= 100;
		l /= 100;
		var r, g, b;
		if (s === 0) {
			r = g = b = l; // achromatic
		} else {
			const hue2rgb = (p, q, t) => {
				if (t < 0) t += 1;
				if (t > 1) t -= 1;
				if (t < 1 / 6) return p + (q - p) * 6 * t;
				if (t < 1 / 2) return q;
				if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
				return p;
			};
			
			const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
			const p = 2 * l - q;
			r = hue2rgb(p, q, h + 1 / 3);
			g = hue2rgb(p, q, h);
			b = hue2rgb(p, q, h - 1 / 3);
		}
		
		const toHex = x => {
			const hex = Math.round(x * 255).toString(16);
			return hex.length === 1 ? '0' + hex : hex;
		};
		return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
	}
	
	function mix(color_1, color_2, weight) {
		color_1 = color_1.slice(1);
		color_2 = color_2.slice(1);
		function d2h(d) { return d.toString(16); }  // convert a decimal value to hex
		function h2d(h) { return parseInt(h, 16); } // convert a hex value to decimal 
		weight = (typeof(weight) !== 'undefined') ? weight : 50; // set the weight to 50%, if that argument is omitted
		var color = '#';
		for( var i=0; i<=5; i+=2 ){ // loop through each of the 3 hex pairsزed, green, and blue
			var v1 = h2d(color_1.substr(i, 2)), // extract the current pairs
				v2 = h2d(color_2.substr(i, 2)),
				// combine the current pairs from each source color, according to the specified weight
				val = d2h(Math.floor(v2 + (v1 - v2) * (weight / 100.0))); 		
			while(val.length < 2) { val = '0' + val; } // prepend a '0' if val results in a single digit
			color += val; // concatenate val to our new color string
		}
		return color;
	}
	
	// GAME MODES	
	function exMode(gameID) {
		gameData[gameID].gameType = 'ex';
		gameData[gameID].rows = 11;
		gameData[gameID].cols = 21;
		initializeBoard (gameID, gameData[gameID].rows, gameData[gameID].cols);
		updateBlock(gameID, 5,  6, 'base');
		updateBlock(gameID, 17, 6, 'base');	
		gameData[gameID].timeLimit  = 60;
		gameData[gameID].timerValue = 60;
		
		gameData[gameID].blockList = {
			star   : { ammo: 1 },
			plus   : { ammo: 'inf' },
			cross  : { ammo: 'inf' },
			arrow4 : { ammo: 2 },
			arrow6 : { ammo: 2 },
			arrow7 : { ammo: 2 },
			arrow9 : { ammo: 2 },
			reclaim: { ammo: 1 },
			
			circle: { ammo: 2 },
			oplus : { ammo: 2 },
			ocross: { ammo: 2 },
			arrow8: { ammo: 2 },
			arrow2: { ammo: 2 },
			arrow1: { ammo: 2 },
			arrow3: { ammo: 2 },
			mine  : { ammo: 3 }
		};
		
		gameData[gameID].collisionMode = { permanence: 5 }; // use false for no limit
	}
	
	function practiceMode(gameID) {
		gameData[gameID].gameType = 'practice';
		gameData[gameID].rows = 11;
		gameData[gameID].cols = 21;
		initializeBoard (gameID, gameData[gameID].rows, gameData[gameID].cols);
		updateBlock(gameID, 5,  6, 'base');
		updateBlock(gameID, 17, 6, 'base');
		gameData[gameID].timeLimit  = false;
		gameData[gameID].timerValue = false;
		
		gameData[gameID].blockList = {
			star   : { ammo: 1 },
			plus   : { ammo: 'inf' },
			cross  : { ammo: 'inf' },
			arrow4 : { ammo: 2 },
			arrow6 : { ammo: 2 },
			arrow7 : { ammo: 2 },
			arrow9 : { ammo: 2 },
			reclaim: { ammo: 1 },
			
			circle: { ammo: 2 },
			oplus : { ammo: 2 },
			ocross: { ammo: 2 },
			arrow8: { ammo: 2 },
			arrow2: { ammo: 2 },
			arrow1: { ammo: 2 },
			arrow3: { ammo: 2 },
			mine  : { ammo: 3 }
		};
		
		gameData[gameID].collisionMode = { permanence: 5 }; // use false for no limit
	}
	
	
	//given a game and base coords, clear everything around it.
	//apparently this doesn't work well for non-standard(20x11) board sizes(?)
	function clearBase( gameID, baseX, baseY ){
		updateBlock(gameID, baseX,   baseY,   'base' );
		updateBlock(gameID, baseX-1, baseY-1, 'blank');
		updateBlock(gameID, baseX-1, baseY,   'blank');
		updateBlock(gameID, baseX-1, baseY+1, 'blank');
		updateBlock(gameID, baseX,   baseY-1, 'blank');
		updateBlock(gameID, baseX,   baseY+1, 'blank');
		updateBlock(gameID, baseX+1, baseY-1, 'blank');
		updateBlock(gameID, baseX+1, baseY,   'blank');
		updateBlock(gameID, baseX+1, baseY+1, 'blank');
	}
	
	
	function randomMode(gameID) {
		gameData[gameID].gameType = 'random';
		var quadrant = (Math.floor(Math.random() * 2));
		var p1x, p1y, p2x, p2y;
		
		function getRandomStartPos() { return (2 + (Math.floor(Math.random() * 3))); }
		
		p1x = 1 + getRandomStartPos();
		p2x = gameData[gameID].cols - getRandomStartPos();
		
		if (quadrant == 0) {
			p1y = 1 + getRandomStartPos();
			p2y = gameData[gameID].rows - getRandomStartPos();
		} else if (quadrant == 1) {
			p1y = gameData[gameID].rows - getRandomStartPos();
			p2y = 1 + getRandomStartPos();
		}
		
		initializeBoard(gameID, gameData[gameID].rows, gameData[gameID].cols);
		
		function randomTerrain() {
			// get random blockType for the random board generator
			// this is just something I threw together
			// might try improving it later on

			var random = Math.round(Math.random());
			if (random) {
				var random = Math.round(Math.random());
				if (random) {
					
					// ~25% chance for an arrow block
					random = Math.ceil(Math.random() * 13);
					if (random == 5) {
						// unless it's a 5. then it's a jump block
						random = Math.round(Math.random());
						if (random) return 'ocross';
						return 'oplus';	
					}
					
					// give a random arrow block.
					if (random == 10) return 'hbar';
					if (random == 11) return 'vbar';
					if (random == 12) return 'tlbr';
					if (random == 13) return 'bltr';
					return ('arrow' + random);

				} else {
					// it's not an arrow or ice. so give a plus or a cross.
					random = Math.round(Math.random());
					if (random) return 'plus';
					return 'cross';
				}
			}
			
			return 'ice'; // half is ice
		}

		// generate some terrain!
		// the 0.12 figure is used to fill up (at most) 12% of the board with terrain
		// it could be less, though, if randX & randY end up the same as a prior update.
		// i don't care too much tho, bc it's just a bit of variance in how the randomness plays out.
		for (var i = 0; i < (0.12 * gameData[gameID].rows * gameData[gameID].cols); i++) {
			var randX = Math.ceil(Math.random() * gameData[gameID].cols);
			var randY = Math.ceil(Math.random() * gameData[gameID].rows);
			var randType = randomTerrain();
			updateBlock(gameID,randX,randY,randType);
		}
		
		// clear space around bases
		clearBase(gameID, p1x, p1y);
		clearBase(gameID, p2x, p2y);
		
		/*
		updateBlock(gameID, p1x, p1y, "base");
		updateBlock(gameID, p1x - 1, p1y - 1, "blank");
		updateBlock(gameID, p1x - 1, p1y, "blank");
		updateBlock(gameID, p1x - 1, p1y + 1, "blank");
		updateBlock(gameID, p1x, p1y - 1, "blank");
		updateBlock(gameID, p1x, p1y + 1, "blank");
		updateBlock(gameID, p1x + 1, p1y - 1, "blank");
		updateBlock(gameID, p1x + 1, p1y, "blank");
		updateBlock(gameID, p1x + 1, p1y + 1, "blank");
		
		updateBlock(gameID, p2x, p2y, "base");
		updateBlock(gameID, p2x - 1, p2y - 1, "blank");
		updateBlock(gameID, p2x - 1, p2y, "blank");
		updateBlock(gameID, p2x - 1, p2y + 1, "blank");
		updateBlock(gameID, p2x, p2y - 1, "blank");
		updateBlock(gameID, p2x, p2y + 1, "blank");
		updateBlock(gameID, p2x + 1, p2y - 1, "blank");
		updateBlock(gameID, p2x + 1, p2y, "blank");
		updateBlock(gameID, p2x + 1, p2y + 1, "blank");
		*/
		
		var rand1 = rand(1,3);
		var rand2 = rand(1,3);
		var rand3 = rand(1,3);
		var rand4 = rand(1,3);
		
		gameData[gameID].blockList = {
			plus  : { ammo: 'inf' },
			cross : { ammo: 'inf' },
			arrow4: { ammo: rand1 },
			arrow6: { ammo: rand1 },
			arrow7: { ammo: rand2 },
			arrow9: { ammo: rand4 },
			
			oplus : { ammo: rand(1,3) },
			ocross: { ammo: rand(1,3) },
			arrow8: { ammo: rand3 },
			arrow2: { ammo: rand3 },
			arrow1: { ammo: rand4 },
			arrow3: { ammo: rand2 }
		};
		
		if (rand(1,2) == 2) gameData[gameID].blockList['reclaim'] = { ammo: (rand(1,2)) };
		
		gameData[gameID].blockList['circle'] = { ammo: (rand(1,3)) };
		
		if (rand(1,4) !== 4) gameData[gameID].blockList['mine']   = { ammo: (rand(1,5)) };
		if (rand(1,3) !== 2) gameData[gameID].blockList['star']   = { ammo: (rand(1,2)) };
		if (rand(1,4)  == 4) gameData[gameID].blockList['knight'] = { ammo: 1 };
		
		gameData[gameID].collisionMode = { permanence: 5 };
		gameData[gameID].timeLimit  = 60;
		gameData[gameID].timerValue = 60;
	}

	function initializeBoard(gameID, rows, cols) {
		gameData[gameID].board = [];
		
		function addBlockInfo(x, y) {
			gameData[gameID].board.push ({
				x : x, // x position
				y : y, // y position
				
				type : 'blank', // blockType
				duration : false, // how long does this block last (used for collision mode)
				
				possession : [], // who can access this block? (socket id)
				color : emptyColor, // current block color
				possessionDisplayName : false, // display name of whoever possesses the block
				possessionSpread : {}, // order of the spread. format is playerID: int.
				possessionColorSpread : [], // another format for spread simply giving color & layer.
				
				moveNum : 0, // which turn was it placed on?
				origin : false, // who placed this block? (socket.id)
				originColor : false, // what is the hex color of the player who placed this block?
				
				history : [] // will contain cause, turn, playerDisplayName, playerColor, blockType.
			});
		}
		
		// loop thru every row and column and add the empty blocks
		for (var i = 0; i < gameData[gameID].rows; i++) {
			for (var j = 0; j < gameData[gameID].cols; j++) addBlockInfo(j, i);
		}
	}
	
	function unreadyAll(gameID) {
		var refresh = false;
		for (var playerID in gameData[gameID].players) {
			if (unready(gameID, playerID)) refresh = true;
		}
		if (refresh) io.to(gameID).emit('UI_BOARD_RENDER', gameData[gameID].board);
	}
	
	function allPlayersReady(gameID) {
		if (Object.keys(gameData[gameID].players).length !== gameData[gameID].maxPlayers) return false;
		for (var id in gameData[gameID].players) {
			if (gameData[gameID].players[id].ready !== true) return false; 
		}
		return true;
	}
	
	function unready(gameID, playerID) {
		if (gameData[gameID].players[playerID].ready) {
			io.to(gameID).emit('LOG_CHAT_MSG', '<span class="dimMsg">'+ userData[playerID].username +' isn\'t ready.</span>');
			gameData[gameID].players[playerID].ready = false;
			wipePossession(gameID, playerID); 
			
			var pos = get_pos(gameID, gameData[gameID].players[playerID].baseX , gameData[gameID].players[playerID].baseY)
			gameData[gameID].board[pos].possession.push(playerID); // ??
			gameData[gameID].board[pos].possessionDisplayName = userData[playerID].username;
			gameData[gameID].board[pos].color = gameData[gameID].players[playerID].color;
			//io.to(gameID).emit('remove from heading', playerID);
			return true;
		}
		return false;
	}
	
	function startGame(gameID) {
		io.to(gameID).emit('LOG_CHAT_MSG', '<span style="font-weight:bold">Starting '+ gameData[gameID].title +'.</span>');
		
		gameData[gameID].gameState = 'inprogress';
		gameData[gameID].remainingPlayers = gameData[gameID].maxPlayers;
		gameData[gameID].moveCount = 1;
		
		if( gameData[gameID].timeLimit != false ) resetTimer(gameID);
		
		for (var block in gameData[gameID].blockList) {
			for (var player in gameData[gameID].players) {
				gameData[gameID].players[player].blockList[block] = { ammo: gameData[gameID].blockList[block].ammo };
			}
		}
		
		io.to(gameID).emit('LOG_CHAT_MSG', '<span class="dimMsg">Turn <b>1</b></span>');
		io.to(gameID).emit('all players ready', 
			gameID, 
			gameData[gameID].timeLimit,
			gameData[gameID].players,
			gameData[gameID].rows,
			gameData[gameID].cols,
			gameData[gameID].board,
			gameData[gameID].gameType
		);
		updateLobby();
	}
	
	function allPlayersMoved(players) {
		for (var id in players) {
			if (players[id].hasMoved == false) return false;
		}
		return true; 
	}
	
	// this is only capable of finding one base.. does that matter for 4player games?
	function findBase(gameID, playerID) {
		for (var i=0; i < gameData[gameID].board.length; i++) {
			if (gameData[gameID].board[i].type == 'base') {
				if (gameData[gameID].board[i].possession[0] == playerID) {
					var x = gameData[gameID].board[i].x + 1;
					var y = gameData[gameID].board[i].y + 1;
					return [x,y];
				}
			}
		}
	}

	function wipeAndDetect(gameID) {
		if (gameData[gameID].collisionMode.permanence !== true) wipeCollisions(gameID);
		
		for (var i=0; i < gameData[gameID].board.length; i++) {
			gameData[gameID].board[i].possessionSpread = {}; // wipe possessionSpread
			gameData[gameID].board[i].possessionColorSpread = [];
		}
		
		for (var playerID in gameData[gameID].players) {
			wipePossession(gameID, playerID);
			if ((gameData[gameID].players[playerID].disconnected) || (gameData[gameID].players[playerID].forfeit)) {
				io.to(gameID).emit('LOG_CHAT_MSG', '<span class="dimMsg">not relighting forfeit/dc\'d player</span>');
			} else {
				var x = gameData[gameID].players[playerID].baseX;
				var y = gameData[gameID].players[playerID].baseY;
				var pos = get_pos(gameID, x, y);
				gameData[gameID].board[pos].possession.push(playerID);
				gameData[gameID].board[pos].color = getColor(gameID, gameData[gameID].board[pos].possession);
				optionsDetection2(gameID, x, y, playerID);
			}
		}
		
		for (var i=0; i < gameData[gameID].board.length; i++) {
			// set possessionSpread color...
			var length = Object.keys(gameData[gameID].board[i].possessionSpread).length;
			
			if (length === 1) {
				
				// if the length is 1 we just need to know which spread layer.
				// along with the player color.
				for (playerID in gameData[gameID].board[i].possessionSpread) {
					var passedColor = getColor(gameID, [playerID]);
					var passedLayer = gameData[gameID].board[i].possessionSpread[playerID];	
					gameData[gameID].board[i].possessionColorSpread = [{
						color: passedColor,
						layer: passedLayer
					}];
				}
				
			} else if (length === 2) {
				
				// if the length is 2 then we need to know which player's spread hit the square when.
				// the second player to hit the square w/ the spread uses the mixed color	
				var collection = [];
				var players = [];
				for (playerID in gameData[gameID].board[i].possessionSpread) {
					var passedColor = getColor(gameID, [playerID]);
					var passedLayer = gameData[gameID].board[i].possessionSpread[playerID];
					collection.push({
						color: passedColor,
						layer: passedLayer
					});
					players.push(playerID); // push playerIDs into an array for use in getColor (for mixed colors)
				}
				
				if (collection[0].layer == collection[1].layer) {
					// both player spread hit at the same time so just add the mixed color for that layer.
					gameData[gameID].board[i].possessionColorSpread = [{
						color: getColor(gameID, players),
						layer: collection[0].layer
					}];
					
				} else if (collection[0].layer < collection[1].layer) {
					// 0 before 1.
					gameData[gameID].board[i].possessionColorSpread.push({
						color: collection[0].color,
						layer: collection[0].layer
					});
					
					gameData[gameID].board[i].possessionColorSpread.push({
						color: getColor(gameID, players),
						layer: collection[1].layer
					});
					
				} else if (collection[0].layer > collection[1].layer) {
					// 1 before 0.
					gameData[gameID].board[i].possessionColorSpread.push({
						color: collection[1].color,
						layer: collection[1].layer
					});
					
					gameData[gameID].board[i].possessionColorSpread.push({
						color: getColor(gameID, players),
						layer: collection[0].layer
					});
					
				}
			}
		}
	}
	
	function wipePossession(gameID, socketID) {
		for (var i=0; i < gameData[gameID].board.length; i++) {
			for (var j = 0; j < gameData[gameID].board[i].possession.length; j++) {
				if (gameData[gameID].board[i].possession[j] == socketID) {
					gameData[gameID].board[i].possession.splice(j,1);
					if (gameData[gameID].board[i].possession.length == 0) {
						gameData[gameID].board[i].possessionDisplayName = false;
					} else {
						// assuming only 1 name then
						gameData[gameID].board[i].possessionDisplayName = userData[gameData[gameID].board[i].possession[0]].username;
					}
					gameData[gameID].board[i].color = getColor(gameID, gameData[gameID].board[i].possession);
				}
			}
		}
	}
	
	function wipeCollisions(gameID) {
		
		var permanence = gameData[gameID].collisionMode.permanence;
		// collisionMode.permanence is an int that says how many turns the block should stick around for.
		for (var i=0; i < gameData[gameID].board.length; i++) {
		// loop the entire board
			if (gameData[gameID].board[i].duration !== false) {
				// if we find a block with a duration
				if (gameData[gameID].board[i].moveNum <= (gameData[gameID].moveCount - permanence)) {
					var xy = get_coords(gameID, i);
					updateBlock(gameID, xy[0], xy[1], 'blank', 'collision fade');
				} else {
					gameData[gameID].board[i].duration--;
				}
			}
		}
	}
	
	/*
	function wipePossession(gameID) {
		// this will clear possession everywhere except the player's base.
		// wait... do I even need to set the player's base??
		// oh I think I do bc the base itself must be colored the base color
		// lol
		
		for (var i = 0; i < gameData[gameID].board.length; i++) {
			gameData[gameID].board[i].possession = 0;
		}
		if (gameData[gameID].player1 != false) {
			var pos = get_pos(gameID, gameData[gameID].p1x, gameData[gameID].p1y);
			gameData[gameID].board[pos].possession = 1;
		}
		if (gameData[gameID].player2 != false) {
			var pos = get_pos(gameID, gameData[gameID].p2x, gameData[gameID].p2y);
			gameData[gameID].board[pos].possession = 2;
		}
	}
	*/
	
	// pass in the socket.id and return player number.
	function getPlayerNumber(gameID, id) {
		if (id == gameData[gameID].player1) return 1;
		if (id == gameData[gameID].player2) return 2;
		return 'spectator';
	}
	
	function getGameID(socket) {
		return socket.rooms[1].split('-').pop();
		/*
		for (var i = 0; i < gameData.length; i++) {
			if ((socketID == gameData[i].player1) || (socketID == gameData[i].player2)) return i;
		}
		return false;
		*/
	}

	// create a truncated ID
	function shortID(socketID) { return socketID.toString().substring(0,5); }
	
	function getName(socketID) {
		for (var i = 0; i < userData.length; i++) {
			if (socketID == userData[i].socketid) return userData[i].username;
		}
		return shortID(socketID);
	}
	
	function updateName(socketID, name) {
		for (var i = 0; i < userData.length; i++) {
			if (socketID == userData[i].socketid) userData[i].username = name;
		}
	}
	
	function resetTimer(gameID) {
		// called when:
		// * a new game is started
		// * after each turn
		
		if (typeof gameData[gameID] == 'undefined') {
			io.emit('LOG_CHAT_MSG', '<span class="redMsg">gameID undefined in resetTimer()</span>');
			return;
		}
		
		clearInterval(gameData[gameID].gameTimer); // stop ticking the timer.
		gameData[gameID].timerValue = gameData[gameID].timeLimit; // set the timer to max value
		
		io.to(gameID).emit('UI_TIMER_UPDATE', gameData[gameID].timerValue, gameData[gameID].moveCount); // update timer
		gameData[gameID].timerValue--; // tick it down
		
		gameData[gameID].gameTimer = setInterval( function () {
			
			if (typeof gameData[gameID] === 'undefined') {
				io.emit('LOG_CHAT_MSG', '<span class="redMsg">gameID undefined in resetTimer() setInterval</span>');
				//clearInterval(gameData[gameID].gameTimer); // hope this works. it doesnt.
				return;
			}
			
			if (gameData[gameID].timerValue == 0) {
				// out of time!
				gameData[gameID].timerValue = gameData[gameID].timeLimit; // reset the timer
				performTurn(gameID, gameData[gameID].tempBlock, 'pass');  // next turn!
			} else {
				// this is where it sends, every second, to the client, the updated time.
				// this is really inefficient because there's latency and the timer ticks down irregularly.
				// instead, when a new turn happens the client itself should have a timer tick down.
				// when that timer hits 0 it locks it so you cannot move and waits for the server to send the command that it's time out.
				
				//io.to(gameID).emit('UI_TIMER_UPDATE', gameData[gameID].timerValue, gameData[gameID].moveCount); // update timer	
				gameData[gameID].timerValue--; // tick it down
			}
			
		}, 1000); // this causes it to tick once per second
	}
	
	function performTurn(gameID, p1Block, p2Block) {
		
		// called when:
		// * both players move
		// * turn time runs out
		
		// p1Block(2) structure:
		// [0] = X position
		// [1] = Y position
		// [2] = blockType
		// [3] = playerID / socket.id
		
		gameData[gameID].playerOnStandby = false; // no longer on standby
		gameData[gameID].moveCount++;   // increase the move count
		
		var passedTurn = false;  // did a player pass?
		var noMove = false;      // assume no at first.
		var p1X, p1Y, p1Type, p1Origin, p2X, p2Y, p2Type, p2Origin;
		var collision = false;
		
		// somebody ran out of time...
		if ((p1Block == 'pass') || (p2Block == 'pass')) passedTurn = true; 
		
		// get the block data if it exists:
		if( p1Block != 'pass' ){
			p1X      = p1Block[0];
			p1Y      = p1Block[1];
			p1Type   = p1Block[2];
			p1Origin = p1Block[3];
		}
		
		if( p2Block != 'pass' ){
			p2X      = p2Block[0];
			p2Y      = p2Block[1];
			p2Type   = p2Block[2];
			p2Origin = p2Block[3];
		}
		
		function reclaim(type, x, y, origin) {
			var pos = get_pos(gameID, x, y);
			var reclaimed = gameData[gameID].board[pos].type;
			if (typeof gameData[gameID].players[origin].blockList[reclaimed] !== 'undefined') {
				if (gameData[gameID].players[origin].blockList[reclaimed].ammo !== 'inf') {
					gameData[gameID].players[origin].blockList[reclaimed].ammo++;
				}
			} else {
				gameData[gameID].players[origin].blockList[reclaimed] = {ammo: 1};
				console.log(gameData[gameID].players[origin].blockList);
			}
		}
		
		// todo: simplify this/remove empty case
		if ((p1X == p2X) && (p1Y == p2Y)) {
			// if there is a collision then reclaim should fail.
		} else {
			if (p1Type == 'reclaim') reclaim(p1Type, p1X, p1Y, p1Origin);
			if (p2Type == 'reclaim') reclaim(p2Type, p2X, p2Y, p2Origin);
		}
		
		if (gameData[gameID].gameType == "practice") {
			updateBlock(gameID, p2X, p2Y, p2Type, p2Origin); // not fully sure why it uses p2Block / p2X but yeah alright.
		} else {
			// update blocks:
			if (!passedTurn) { // if nobody ran out of time...
				if ((p1X == p2X) && (p1Y == p2Y)) { // check for collision.
					collision = true;
					io.to(gameID).emit('collision'); // COLLISION!!!! this plays client-side sfx.
					updateBlock(gameID, p1X, p1Y, "blockade", 'collision');
				} else {
					// no collision. proper turn; update blocks.
					updateBlock(gameID, p1X, p1Y, p1Type, p1Origin);
					updateBlock(gameID, p2X, p2Y, p2Type, p2Origin);
				}
			} else {
				// one or both players ran out of time.
				if (p1Block !== 'pass') {
					// one player didn't run out of time.
					updateBlock(gameID, p1X, p1Y, p1Type, p1Origin);
					io.to(gameID).emit('time out', p1Origin);
				} else {
					noMove = true;
				}
			}
		}
		
		var playersArray = [];
		for (var playerID in gameData[gameID].players) {
			gameData[gameID].players[playerID].hasMoved = false;
			playersArray.push(playerID);
		}
		
		// detect possession.
		wipeAndDetect(gameID);
		
		// if game is not over:
		if (gameData[gameID].gameState == 'inprogress') {
			gameData[gameID].tempBlock = 'pass'; // reset the temp block to nothing (so if time runs out...)
			io.to(gameID).emit('LOG_CHAT_MSG', '<span class="dimMsg">Turn <b>'+ (gameData[gameID].moveCount) +'</b></span>');
			
			if (p2Type == 'mine explosion' || p1Type == 'mine explosion') io.to(gameID).emit('detonate'); // sfx;
			
			if (gameData[gameID].gameType == "practice") {
				io.to(gameID).emit('GAME_MOVE_NEW', gameData[gameID].board, noMove, gameData[gameID].players[playersArray[0]].blockList);
			} else {
				
				// not practice mode.
				// in the case of mines we need to send a separate board to each player now:
				var thisBoard = JSON.parse(JSON.stringify(gameData[gameID].board));
				for (var i=0; i < thisBoard.length; i++) {
					if (thisBoard[i].type == 'mine') {
						if (thisBoard[i].origin !== playersArray[0]) {
							hiddenInformation(thisBoard[i]);
						}
					}
				}
				
				var thatBoard = JSON.parse(JSON.stringify(gameData[gameID].board));
				for (var i=0; i < thatBoard.length; i++) {
					if (thatBoard[i].type == 'mine') {
						if (thatBoard[i].origin !== playersArray[1]) hiddenInformation(thatBoard[i]);
					}
				}
				
				var specBoard = JSON.parse(JSON.stringify(gameData[gameID].board));
				for (var i=0; i < specBoard.length; i++) {
					if (specBoard[i].type == 'mine') hiddenInformation(specBoard[i]);
				}
				
				io.to(playersArray[0]).emit('GAME_MOVE_NEW', thisBoard, noMove, gameData[gameID].players[playersArray[0]].blockList);
				io.to(playersArray[1]).emit('GAME_MOVE_NEW', thatBoard, noMove, gameData[gameID].players[playersArray[1]].blockList);
				for (var i=0; i < gameData[gameID].specsList.length; i++) {
					io.to(gameData[gameID].specsList[i]).emit('GAME_MOVE_NEW', specBoard, noMove);
				}
				
			}
		}
		
		// if game IS over:
		if (gameData[gameID].gameState == 'gameover') {
			io.to(gameID).emit('GAME_MOVE_NEW', gameData[gameID].board, noMove);			
			gameOver(gameID);
		} else if (gameData[gameID].timeLimit != false) {
			resetTimer(gameID);
		} else {
			io.to(gameID).emit('UI_TIMER_UPDATE', false, gameData[gameID].moveCount); // update turn count.
		}
	}
	
	function hiddenInformation(block) {
		block.type    = 'blank';
		block.moveNum = 0;
		block.origin  = false;
		block.originColor = false;
		block.history = [];
	}
	
	function gameOver(gameID) {
		console.log('gameover called');
		gameData[gameID].gameState = 'gameover';
		stopTimer(gameID);
		
		var winners   = [];
		var winPaths  = [];
		var color     = [];
		var playerIDs = [];
		var drawgame;
		
		for (var playerID in gameData[gameID].players) {
			playerIDs.push (playerID);
			if (gameData[gameID].players[playerID].winner) {
				winners.push(playerID);
				color.push(gameData[gameID].players[playerID].color);
				winPaths.push(gameData[gameID].players[playerID].winPath);
			} else {
				wipePossession(gameID, playerID);
			}
		}
		
		var drawGame = true;
		if (winners.length == 1) drawGame = false;
		
		if (color.length == 1) {
			color = color[0];
		} else {
			if ((typeof color[0] !== 'undefined') && (typeof color[1] !== 'undefined')) {
				// without this if, this actually crashed once.. somehow undefined?
				color = mix(color[0], color[1]);
			}
		}
		
		if (gameData[gameID].gameType === 'practice') {
			// durp
		} else if ((typeof userData[playerIDs[0]].twitterid !== 'undefined') && (typeof userData[playerIDs[1]].twitterid !== 'undefined')) {			
			if (gameData[gameID].moveCount > 1) {
				if (gameData[gameID].ratingsCalculated == false) {
					for (playerID in gameData[gameID].players) {
						if (drawGame == false) {
							if (playerID === winners[0]) {
								gameData[gameID].players[playerID].wins++;
								userData[playerID].wins++;
								userData[playerID].gamesPlayed++;
								if (rand(1,5) !== 5) userData[playerID].remainingRerolls++;
							} else {
								gameData[gameID].players[playerID].losses++;
								userData[playerID].losses++;
								userData[playerID].gamesPlayed++;
								if (rand(1,5) === 5) userData[playerID].remainingRerolls++;
							}
						} else {
							gameData[gameID].players[playerID].draws++;
							userData[playerID].draws++;
							userData[playerID].gamesPlayed++;
							if (rand(1,5) > 2) userData[playerID].remainingRerolls++;
						}
					}
					
					// Elo
					var kFactor = 20;
					if (gameData[gameID].gameType == 'random') kFactor = 7.5;
					
					if (gameData[gameID].moveCount < 8) kFactor *= (gameData[gameID].moveCount / 8);					
					
					var winner, loser;
					if (gameData[gameID].players[playerIDs[0]].winner) {
						winner = playerIDs[0];
						loser  = playerIDs[1];
					} else {
						winner = playerIDs[1];
						loser  = playerIDs[0];
					}
					
					//if ELO's are still the initialization value, update them here
					if (userData[winner].elo === -99999) userData[winner].elo = 1000;
					if (userData[loser].elo  === -99999) userData[loser].elo  = 1000;
					
					var ratingDifference = userData[loser].elo - userData[winner].elo;
					var expectedScoreWinner = 1 / ( 1 + Math.pow(10, ratingDifference/400) );
					
					var actualScore = 1;
					if (drawGame) actualScore = 0.5;
					
					var e = kFactor * (actualScore - expectedScoreWinner);
					
					userData[winner].oldElo = userData[winner].elo;
					userData[winner].elo += e;
					
					userData[loser].oldElo = userData[loser].elo;
					userData[loser].elo  -= e;
					
					gameData[gameID].ratingsCalculated = true;
					
					var p1Score = gameData[gameID].players[playerIDs[0]].wins + (gameData[gameID].players[playerIDs[0]].draws / 2);
					var p2Score = gameData[gameID].players[playerIDs[1]].wins + (gameData[gameID].players[playerIDs[1]].draws / 2);
					
					var postGameMsg = '<div class="postGame">';
					if (drawGame) {
						postGameMsg += '<span class="result">Draw Game!</span>';
					} else {
						postGameMsg += '<span class="result" style="color: '+ userData[winners[0]].color +'">'+ userData[winners[0]].username +' Wins!</span>';
					}
					
					postGameMsg += '<div class="seriesScore"><div style="color: '+ userData[playerIDs[1]].color + '"><span>' + p2Score + '</span></div><div style="color: '+ userData[playerIDs[0]].color + '"><span>' + p1Score + '</span></div></div>';
					for (var j = 0; j <= 1; j++) {
						if (userData[playerIDs[j]].gamesPlayed >= 10) {
							// if user has not played at least 10 games, do not show rating change.
							var prior = Math.round(userData[playerIDs[j]].oldElo) - 1000;
							var post  = Math.round(userData[playerIDs[j]].elo) - 1000;
							if ((prior > 0) || (post > 0)) {
								
								if (prior <= 0) prior = 0;
								if (post  <= 0) post  = 0;
								var change = post - prior;
								
								postGameMsg += '<div><span style="color: '+ gameData[gameID].players[playerIDs[j]].color +'; font-weight:bold;">'+ userData[playerIDs[j]].username +'</span><span class="dimMsg">: ';
								postGameMsg += prior +'&rarr;</span>'+ post +' </span>';
								
								//todo: turn this into an if/else for 0/not 0 and always abs() the change val
								if (change > 0) {
									postGameMsg += '<span class="greenMsg">(+'+ change +')</span>';
								} else if (change == 0) {
									postGameMsg += '<span>(&plusmn;0)</span>';
								} else {
									postGameMsg += '<span class="redMsg">(&minus;'+ Math.abs(change) +')</span>';
								}
								
								postGameMsg += '</div>';
							}
						}
					}
					postGameMsg += '</div>';
					io.to(gameID).emit('LOG_CHAT_MSG', postGameMsg, true);
				
					if (saveData) {
						db.sync(function(err) {
							if (err) throw err;
							
							// Currently anonymous users have negative twitter IDs
							// This can be improved upon later
							if(userData[playerIDs[0]].twitterid < 0) return;
							if(userData[playerIDs[1]].twitterid < 0) return;
							
							if (typeof userData[playerIDs[0]] !== 'undefined') {
								User.find({ twitterID: userData[playerIDs[0]].twitterid }, function (err, users){
									if (err) throw err;
									if ((users[0].gamesPlayed + 1) !== userData[playerIDs[0]].gamesPlayed) {
										io.emit('LOG_CHAT_MSG', '<span class="redMsg">FAILED STATS UPDATE FOR '+ userData[playerIDs[0]].username +'</span>');
										io.emit('LOG_CHAT_MSG', '<span class="redMsg">'+ playerIDs[0] +'</span>');
									} else {
										// sync with userData, which is already done updating.
										users[0].elo = userData[playerIDs[0]].elo;
										users[0].gamesPlayed = userData[playerIDs[0]].gamesPlayed;
										users[0].wins = userData[playerIDs[0]].wins;
										users[0].losses = userData[playerIDs[0]].losses;
										users[0].draws = userData[playerIDs[0]].draws;
										users[0].avgMoveCount += ((gameData[gameID].moveCount - users[0].avgMoveCount) / users[0].gamesPlayed);
										users[0].save(function (err) {
											if (err) throw err;
											console.log("success: "+ userData[playerIDs[0]].username);
										});
									}
								});
							}
							
							if (typeof userData[playerIDs[1]] !== 'undefined') {
								User.find({ twitterID: userData[playerIDs[1]].twitterid }, function (err, users2){
									if (err) throw err;
									if ((users2[0].gamesPlayed + 1) !== userData[playerIDs[1]].gamesPlayed) {
										io.emit('LOG_CHAT_MSG', '<span class="redMsg">FAILED STATS UPDATE FOR '+ userData[playerIDs[1]].username +'</span>');
										io.emit('LOG_CHAT_MSG', '<span class="redMsg">'+ playerIDs[1] +'</span>');
									} else {
										//afaik can only update one user at a time.
										users2[0].elo = userData[playerIDs[1]].elo;
										users2[0].gamesPlayed = userData[playerIDs[1]].gamesPlayed;
										users2[0].wins = userData[playerIDs[1]].wins;
										users2[0].losses = userData[playerIDs[1]].losses;
										users2[0].draws = userData[playerIDs[1]].draws;
										users2[0].avgMoveCount += ((gameData[gameID].moveCount - users2[0].avgMoveCount) / users2[0].gamesPlayed);
										users2[0].save(function (err) {
											if (err) throw err;
											console.log("success: "+ userData[playerIDs[1]].username);
										});
									}
								});
							}
						});
					}
				}
			} else {
				gameData[gameID].ratingsCalculated = true;
				io.to(gameID).emit('LOG_CHAT_MSG', 'No stats collected.');
			}
		} else {
			gameData[gameID].ratingsCalculated = true;
			io.to(gameID).emit('LOG_CHAT_MSG', 'No stats collected.');
		}
		
		//console.log( 'emit to: #'+ gameID +' VICTORY');
		//console.log( 'win paths: '+ winPaths.toString() );
		io.to(gameID).emit('GAME_VICTORY', winners, winPaths, color, gameData[gameID].gameType);
		updateLobby();
	}

	function stopTimer(gameID) {
		if ((typeof gameData[gameID] !== 'undefined') && (gameData[gameID].gameTimer !== false)) {
			clearInterval(gameData[gameID].gameTimer); // stop ticking the timer.
			gameData[gameID].gameTimer = false;
			//io.to(gameID).emit('LOG_CHAT_MSG', '<span class="dimMsg">timer stopped</span>');
		}
	}
	
	function readableBlockName(blockType) { // returns blocknames for hover info that don't suck
		var blockList = {
			'base'    : 'source',
			'ostar'   : 'jump star',
			'plus'    : '+',
			'oplus'   : 'jump +',
			'cross'   : 'x',
			'ocross'  : 'jump x',
			'ohbar'   : 'jump hbar',
			'ovbar'   : 'jump vbar',
			'otlbr'   : 'jump tlbr',
			'obltr'   : 'jump bltr',
			'arrow1'  : 'arrow1',
			'arrow11' : 'jump arrow1',
			'arrow2'  : 'arrow2',
			'arrow22' : 'jump arrow2',
			'arrow3'  : 'arrow3',
			'arrow33' : 'jump arrow3',
			'arrow4'  : 'arrow4',
			'arrow44' : 'jump arrow4',
			'arrow6'  : 'arrow6',
			'arrow66' : 'jump arrow6',
			'arrow7'  : 'arrow7',
			'arrow77' : 'jump arrow7',
			'arrow8'  : 'arrow8',
			'arrow88' : 'jump arrow8',
			'arrow9'  : 'arrow9',
			'arrow99' : 'jump arrow9',
			'mine'    : 'stealthy mine'
		};
		
		//try to return the human-readable name if it exists
		if (blockList.hasOwnProperty(blockType)) return blockList[blockType];
		return blockType;
	}
	
	//returns the circled version of the initial block type given
	function transformCircle(initialType) {
		if (initialType == 'star'  ) return 'ostar';
		if (initialType == 'plus'  ) return 'oplus';
		if (initialType == 'cross' ) return 'ocross';
		if (initialType == 'hbar'  ) return 'ohbar';
		if (initialType == 'vbar'  ) return 'ovbar';
		if (initialType == 'tlbr'  ) return 'otlbr';
		if (initialType == 'bltr'  ) return 'obltr';
		if (initialType == 'arrow1') return 'arrow11';
		if (initialType == 'arrow2') return 'arrow22';
		if (initialType == 'arrow3') return 'arrow33';
		if (initialType == 'arrow4') return 'arrow44';
		if (initialType == 'arrow6') return 'arrow66';
		if (initialType == 'arrow7') return 'arrow77';
		if (initialType == 'arrow8') return 'arrow88';
		if (initialType == 'arrow9') return 'arrow99';
		return false;
	}
	
	
	function updateBlock(gameID, x, y, initialType, origin) {
		// update an individual block, server-side
		// origin is socket.id or 'collision' or 'collision fade'
		
		var pos = get_pos(gameID, x, y); // get_pos finds where in the board array the block data is
		
		var blockType = initialType;
		
		if (initialType == 'mine explosion') blockType = 'blockade';
		
		if (initialType == 'reclaim') blockType = 'blank';
		
		if (initialType == 'circle' ) blockType = transformCircle(gameData[gameID].board[pos].type);
		
		
		// update the block:
		gameData[gameID].board[pos].type = blockType;
		gameData[gameID].board[pos].moveNum = gameData[gameID].moveCount;
		
		var permanence = gameData[gameID].collisionMode.permanence;
		
		if ((blockType == 'blockade') && (permanence !== true)) {
			gameData[gameID].board[pos].duration = permanence + 1;
		} else {
			gameData[gameID].board[pos].duration = false;
		}

		if (typeof origin !== 'undefined') {
			gameData[gameID].board[pos].origin = origin;
			var historyString = '<div>';
			var chatHistoryString = '<div class="dimMsg">';
			var logHistoryString  = ''; // server log history. todo write this to disk
			
			if (initialType !== 'mine') chatHistoryString += '<b>'+ x +','+ y +':</b> ';
			
			if (origin == 'collision' || origin == 'collision fade') {
				historyString     += '<b>'+ origin +'</b> on turn <b>'+ (gameData[gameID].moveCount - 1) +'</b>.';
				chatHistoryString += '<b>'+ origin +'</b>.';
				logHistoryString  += origin +' on turn '+ (gameData[gameID].moveCount - 1);
			} else {
				
				gameData[gameID].board[pos].originColor = gameData[gameID].players[origin].color;
				
				// todo: optimize this! Can be done a lot more elegantly.
				
				switch( initialType ){
					case 'circle':
						historyString     += '<b>circled</b> ';
						chatHistoryString += '<b>circled</b> ';
						logHistoryString  += 'circled ';
						break;
						
					case 'mine explosion':
						historyString     += '<b>mine tripped</b> ';
						chatHistoryString += '<b>mine tripped</b> ';
						logHistoryString  += 'mine tripped ';
						break;
					
					case 'reclaim':
						historyString     += '<b>reclaimed</b> ';
						chatHistoryString += '<b>reclaimed</b> ';
						logHistoryString  += 'reclaimed ';
						break;
					
					default:
						historyString     += '<b>'+ readableBlockName(blockType) +'</b> placed ';
						chatHistoryString += '<b>'+ readableBlockName(blockType) +'</b> placed ';
						logHistoryString  += readableBlockName(blockType) +' placed ';
						break;
				}
				
				//todo: make this 1 string until this point and then just make a new var& append 'on turn X'(?)
				historyString     += 'by <b style="color:'+ gameData[gameID].players[origin].color +'">'+ gameData[gameID].players[origin].username +'</b> on turn <b>'+ (gameData[gameID].moveCount - 1) +'</b>.';
				chatHistoryString += 'by <b style="color:'+ gameData[gameID].players[origin].color +'">'+ gameData[gameID].players[origin].username +'</b>.';
				logHistoryString += 'by '+ gameData[gameID].players[origin].username +' on turn '+ (gameData[gameID].moveCount - 1) +'.';
			}
			historyString += '</div>';
			
			
			//console.log('<#'+gameID+'> ' + logHistoryString);
			chatLog(gameID, 'Game', logHistoryString);
			
			io.to(gameID).emit('LOG_CHAT_MSG', chatHistoryString);
			gameData[gameID].board[pos].history.push(historyString);
				
			/*
			var historyObj = {
				turn: gameData[gameID].moveCount - 1,
				blockType: blockType
			}
			if (origin == 'collision' || origin == 'collision fade') {
				historyObj.cause = origin;
				gameData[gameID].board[pos].origin = origin;
			} else {
				historyObj.cause = 'player';
				historyObj.playerDisplayName = gameData[gameID].players[origin].username;
				historyObj.playerColor = gameData[gameID].players[origin].color;
				gameData[gameID].board[pos].origin = origin;
				gameData[gameID].board[pos].originColor = gameData[gameID].players[origin].color;
			}
			gameData[gameID].board[pos].history.push(historyObj);
			*/
		}
	}
	
	
	// when a block's position in the board array needs to be found, this returns it.
	function get_pos(gameID, x, y) {
		return (y - 1) * gameData[gameID].cols + x - 1; // board[this]
	}
	
	
	// opposite of get_pos, takes the position in array and returns x/y coords.
	function get_coords(gameID, pos) {
		var x = (pos % gameData[gameID].cols) + 1;
		var y = ((pos - x + 1) / gameData[gameID].cols) + 1;
		return [x,y];
	}
	
	
	function getMoves(blockType) {
		// finds out where each block can move to
		// base, star, and various others aren't used right now.
		// I will add more blocks later too, such as the knight block.
		// I want to also add ice block, which is complex...
		// I'll have to figure out not only which squares can be accessed
		// but also which direction the player came from...

		var blockList = {
			'base'    : function () { return [[-1,-1], [0,-1], [1,-1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]; },
			'star'    : function () { return [[-1,-1], [0,-1], [1,-1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]; },
			'ostar'   : function () { return [[-2,-2], [0,-2], [2,-2], [-2, 0], [2, 0], [-2, 2], [0, 2], [2, 2]]; },
			'plus'    : function () { return [[0,-1], [-1, 0], [1, 0], [0, 1]]; },
			'oplus'   : function () { return [[0,-2], [-2, 0], [2, 0], [0, 2]]; },
			'cross'   : function () { return [[-1,-1], [1,-1], [-1, 1], [1, 1]]; },
			'ocross'  : function () { return [[-2,-2], [2,-2], [-2, 2], [2, 2]]; },
			'hbar'    : function () { return [[-1, 0], [1, 0]]; },
			'ohbar'   : function () { return [[-2, 0], [2, 0]]; },
			'vbar'    : function () { return [[0, -1], [0, 1]]; },
			'ovbar'   : function () { return [[0, -2], [0, 2]]; },
			'tlbr'    : function () { return [[-1, -1], [1, 1]]; },
			'otlbr'   : function () { return [[-2, -2], [2, 2]]; },
			'bltr'    : function () { return [[-1, 1], [1, -1]]; },
			'obltr'   : function () { return [[-2, 2], [2, -2]]; },
			'arrow1'  : function () { return [[-1, 1]]; },
			'arrow11' : function () { return [[-2, 2]]; },
			'arrow2'  : function () { return [[0, 1]]; },
			'arrow22' : function () { return [[0, 2]]; },
			'arrow3'  : function () { return [[1, 1]]; },
			'arrow33' : function () { return [[2, 2,]]; },
			'arrow4'  : function () { return [[-1, 0]]; },
			'arrow44' : function () { return [[-2, 0]]; },
			'arrow6'  : function () { return [[1, 0]]; },
			'arrow66' : function () { return [[2, 0]]; },
			'arrow7'  : function () { return [[-1, -1]]; },
			'arrow77' : function () { return [[-2, -2]]; },
			'arrow8'  : function () { return [[0, -1]]; },
			'arrow88' : function () { return [[0, -2]]; },
			'arrow9'  : function () { return [[1, -1]]; },
			'arrow99' : function () { return [[2, -2,]]; },
			'blockade': function () { return [[]]; },
			'blank'   : function () { return [[]]; },
			'mine'    : function () { return [[]]; },
			'reclaim' : function () { return [[]]; },
			'ice'     : function () { return [[]]; },
			'knight'  : function () { return [[1, 2], [2, 1], [-1, 2], [2, -1], [1, -2], [-2, 1], [-1, -2], [-2, -1]]; }
		};

		if (typeof blockList[blockType] !== 'function') {
			io.emit('LOG_CHAT_MSG', '<span class="redMsg">blockType not a function in getMoves()</span>');
			return [[]];
		} 
		
		// i found this cute trick online, instead of mass switch statement or if or w/e...
		return blockList[blockType]();
	}
	
	
	function validateMove(gameID, blockType, pos, playerID) {
		var initialType = gameData[gameID].board[pos].type;
		
		if (typeof gameData[gameID].players[playerID].blockList[blockType] == 'undefined') return false;
		
		//ammo check and update ammo count
		if (gameData[gameID].players[playerID].blockList[blockType].ammo === 0) return false;
		gameData[gameID].players[playerID].blockList[blockType].ammo--;

		switch(blockType) {
			
			case 'circle':
				var validTypes = ['star','plus','cross','hbar','vbar','tlbr','bltr','arrow1','arrow2','arrow3','arrow4','arrow6','arrow7','arrow8','arrow9'];
				if (validTypes.includes(initialType)) return blockType;
				//if( transformCircle(initialType) ) return blockType;
				return false;
				break;
				
			case 'reclaim':
				if ((initialType !== 'blank' && initialType !== 'base' && initialType !== 'blockade' && initialType !== 'mine')) {
					if (gameData[gameID].board[pos].possession.length === 1) {
						if (gameData[gameID].board[pos].possession[0] === playerID) return 'reclaim';
					}	
				}
				break;
			
			default:
				if (initialType === 'blank') return blockType;
				if (initialType === 'mine' ) return 'mine explosion';
				return false;
				break;
				
		} // switch
	}
	
	
	function optionsDetection2(gameID, x, y, playerID) {
		var queue = [[gameID, x, y, playerID, undefined, 0, undefined]];
		while (queue.length) {
			var newCollection = (optionsDetection(queue[0][0], queue[0][1], queue[0][2], queue[0][3], queue[0][4], queue[0][5], queue[0][6]));
			for (var i = 0; i < newCollection.length; i++) {
				queue.push(newCollection[i]);
			}
			queue.shift();	
		}
	}
	
	
	function optionsDetection(gameID, x, y, playerID, passedWinPath, currentLayer, iceDir) {
		var collection = [];
		var pos = get_pos(gameID, x,y);
		
		if (typeof iceDir === 'undefined') iceDir = false;
		
		if (iceDir !== false) {
			dir = iceDir;
			iceDir = false;
		} else {
			var someType = gameData[gameID].board[pos].type;
			var dir = getMoves(someType);
		}
		
		if (typeof passedWinPath === 'undefined') { 
			var winPath = [];
			currentLayer = 0;
		} else {
			var winPath = passedWinPath.slice();
		}
		
		winPath[currentLayer] = pos;
		for (var i = 0; i < dir.length; i++) {
			var newX = x + dir[i][0];
			var newY = y + dir[i][1];
			if (((newX >= 1) && (newX <= gameData[gameID].cols)) && ((newY >= 1) && (newY <= gameData[gameID].rows))) { // if we're not out of bounds
				var newPos = get_pos(gameID, newX,newY);
				var newType = gameData[gameID].board[newPos].type;			
				var run = true;
				if (gameData[gameID].board[newPos].possession.indexOf(playerID) >= 0) {
					// if you already have possession, run = false.
					run = false;
					if (currentLayer < gameData[gameID].board[newPos].possessionSpread[playerID]) { // always false with the queue, redundant.
						gameData[gameID].board[newPos].possessionSpread[playerID] = currentLayer;
						run = true;
					}
				} else if (newType !== 'ice' && newType !== 'blockade') {
					// set possession and color, if not ice.
					gameData[gameID].board[newPos].possession.push(playerID);
					gameData[gameID].board[newPos].possessionSpread[playerID] = currentLayer;
					if (gameData[gameID].board[newPos].possession.length == 2) {
						gameData[gameID].board[newPos].possessionDisplayName = 'Both';
					} else {
						gameData[gameID].board[newPos].possessionDisplayName = userData[gameData[gameID].board[newPos].possession[0]].username;
					}
					gameData[gameID].board[newPos].color = getColor(gameID, gameData[gameID].board[newPos].possession);
				} else if (someType === 'knight' && newType === 'ice') {
					run = false; // knights may not jump on ice.
				}
				
				if ((newType != "blank") && (run == true)) { 
					if (newType == 'base') {
						if (gameData[gameID].board[newPos].possession !== [playerID]) {
							gameData[gameID].players[playerID].winner = true; 
							gameData[gameID].gameState = 'gameover';
							if (gameData[gameID].players[playerID].winPath.length == 0 ) {
								gameData[gameID].players[playerID].winPath = winPath.slice(0, currentLayer+1);
								gameData[gameID].players[playerID].winPath.push(newPos);
							}
						}
					} else if (newType == 'ice') {
						var iceX = 0;
						var iceY = 0;
						if( dir[i][0] < 0 ) iceX = -1;
						if( dir[i][0] > 0 ) iceX = 1;
						if( dir[i][1] < 0 ) iceY = -1;
						if( dir[i][1] > 0 ) iceY = 1;
						iceDir = [ [iceX, iceY] ];
					}
					
					var newLayer = currentLayer + 1;
					//optionsDetection(gameID, newX, newY, playerID, winPath, newLayer, iceDir);
					collection.push( [gameID, newX, newY, playerID, winPath, newLayer, iceDir] );
					iceDir = false;
				}
			}
		}
		return collection;
	}
	
	
	function getColor(gameID, possession){
		// send a possession array here after splicing or adding to return the color the block should be.	
		if (possession.length == 0) return emptyColor;
		
		if (possession.length == 1) return gameData[gameID].players[possession[0]].color;
		
		if (possession.length == 2) {
			var color1 = gameData[gameID].players[possession[0]].color;
			var color2 = gameData[gameID].players[possession[1]].color;
			return mix(color1, color2);
		}
		
		/*
		if (possession.length > 2) {
			io.to(gameID).emit('LOG_CHAT_MSG', '<b>sorry i need to add mixing of 3 or more colors.</b>');
			return emptyColor;
		}
		*/
		return emptyColor;
	}
	
	
	function returnDisplayElo(socketID) {
		var displayElo = Math.round(userData[socketID].elo) - 1000;
		if ((displayElo < 0) || (userData[socketID].gamesPlayed < 10)) displayElo = 0;
		return displayElo;
	}
	
	
	function renderLobby(socket) {

		// callback function after gathering data from DB:
		var handleResult = function(err, leaderD) {
			if (err) {
				console.log("handleResult err");
				return;
			}
			
			// no error
			if (lobbyUserData !== false) socket.emit('UI_LOBBY_RENDER', lobbyD, leaderD, lobbyUserData);
		}

		var lobbyD = lobbyData();
		var lobbyUserData = false;
		if (typeof socket !== 'undefined') {
			lobbyUserData = {
				username    : userData[socket.id].username,
				color       : userData[socket.id].color,
				gamesPlayed : userData[socket.id].gamesPlayed,
				timePlayed  : userData[socket.id].timePlayed,
				wins        : userData[socket.id].wins,
				draws       : userData[socket.id].draws,
				losses      : userData[socket.id].losses,
				displayElo  : returnDisplayElo(socket.id),
				remainingRerolls : userData[socket.id].remainingRerolls
			};
		}
		leaderData(handleResult); // gets data from DB
	}

	
	function updateLobby() {
		// the primary difference between 'UI_LOBBY_UPDATE' and 'UI_LOBBY_RENDER'
		// is that 'UI_LOBBY_UPDATE' only updates Games and Leaderboard
		// while 'UI_LOBBY_RENDER' renders the lobby including user stats, welcome message, option buttons.
		
		// callback function after gathering data from DB:
		var handleResult = function(err, leaderD) {
			if (err) {
				console.log("handleResult err");
				return;
			}
			// no error
			io.to("lobby").emit('UI_LOBBY_UPDATE', lobbyD, leaderD);
		}

		var lobbyD = lobbyData();
		var leaderD = leaderData(handleResult);
	}

	function lobbyData() {
		var lobbyData = [];
		for (var game in gameData) {
			if (gameData[game].gameState !== 'gameover'); {
				if (typeof userData[gameData[game].creator] !== 'undefined') {
					// this crashed from undefined before. be careful!
					
					// _full is a var used to determine if an open room is full
					// if it is full, then do not render the "Play" button in the lobby.
					var _full, _elo, _opponent, _opponentColor, _opponentElo;
					
					var playerCount = Object.keys(gameData[game].players).length;
					
					_full = true;
					if ((playerCount < gameData[game].maxPlayers)) _full = false;
					
					_elo = returnDisplayElo(gameData[game].creator);

					if (_full) {
						for (var player in gameData[game].players) {
							if (player !== gameData[game].creator) {
								if (typeof userData[player] !== 'undefined') {
									_opponent = userData[player].username;
									_opponentColor = userData[player].color;
									_opponentElo = returnDisplayElo(player);
								}
							}
						}
					}
					
					lobbyData.push({
						id            : game,
						title         : gameData[game].title,
						gameState     : gameData[game].gameState,
						full          : _full,
						creator       : userData[gameData[game].creator].username,
						creatorColor  : userData[gameData[game].creator].color,
						opponent      : _opponent,
						opponentColor : _opponentColor,
						opponentElo   : _opponentElo,
						gameType      : gameData[game].gameType,
						creatorElo    : _elo
					});
				}
			}
		}
		return lobbyData;
	}

	
	function leaderData(callback) {
		db.driver.execQuery("SELECT * FROM users ORDER BY elo DESC LIMIT 100", function (err, data) {
			if (err) { return callback(err); }
			
			var leaderData = [];
			for (var i=0; i < data.length; i++) {
				//if ((data[i].gamesPlayed >= 10) && (Math.round(data[i].elo) > 1000)) {
				if ((data[i].gamesPlayed >= 1) && (Math.round(data[i].elo) > 0)) {
					leaderData.push({
						displayName : decodeURI(data[i].displayName),
						color       : data[i].color,
						gamesPlayed : data[i].gamesPlayed,
						wins        : data[i].wins,
						draws       : data[i].draws,
						losses      : data[i].losses,
						elo         : Math.round(data[i].elo)
						//elo         : (Math.round(data[i].elo) - 1000)
					});
				}
			}
			return callback(null, leaderData);
		});
	}
} // end of game logic.


function connectToDB(callback){
	// time to connect to the database:
	var User = undefined;
	var db = orm.connect(CREDENTIALS.database, function (err, _db) {
		if (err) { return callback(err); }
		
		User = _db.define("users", {
			id            : Number,
			displayName   : String,
			wins          : Number,
			draws         : Number,
			losses        : Number,
			elo           : Number,
			color         : String,
			twitterID     : String,
			gamesPlayed   : Number,
			twitterHandle : String,
			forfeits      : Number,
			//winsByForfeit : Number,
			avgMoveCount  : Number,
			connections   : Number,
			timePlayed    : Number
		});
		
		console.log("Connected to database.");
		return callback(null, User, db);
	});
}

connectToDB(handleDBResult);
