const database = require("./database");
const bcrypt = require('bcrypt');                         // encrypt passwords
const nodemailer = require('nodemailer');				  // send email
var request = require('request');                         // send HTTP requests
var GoogleAuth = require('google-auth-library');		  // authenticate google user tokens to sign users in with a google Account
var auth = new GoogleAuth;
var client = new auth.OAuth2("285224215537-l5a1ol101rmutrvbcd2omt5r3rktmh6v.apps.googleusercontent.com", '', '');
var sanitizeHtml = require('sanitize-html');			  // sanitize HTML
var showdown  = require('showdown');					  // convert Markdown to HTML
  



var transporter = nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.ZOHO_USERNAME,
        pass: process.env.ZOHO_PASSWORD 
    }
});

showdown.extension('myext', function () {
  var store = '';
  var lngExt = function (text, converter, options) {
    var globals = {converter: converter};
    options.strikethrough = true;
    text = showdown.subParser('italicsAndBold')(text, options, globals);
    text = showdown.subParser('strikethrough')(text, options, globals);
    text = showdown.subParser('codeSpans')(text, options, globals);
    text = text.trim();
    store = text;
    return "";
  };
  var otpExt = function (text, converter, options) {
    return store;
  };
  return [
    {
      type: 'lang',
      filter: lngExt
    },
    {
      type: 'output',
      filter: otpExt
    }
  ];
});

var converter = new showdown.Converter();



const commonPasswords = ["123456", "password", "password1", "password123", "password321", "123456", "654321", "12345678", "87654321", "football", "qwerty", "1234567890", "1234567", "princess", "aaaaaa", "111111"]


function search(db, req, callback){

req.body.term = req.body.term.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");


	searchQuery = {
		name: {
			$regex: RegExp(req.body.term),
			$options: 'i'
		}
	}

	console.log("searchQuery");
	console.log(searchQuery);

    var thisUsername = null;

    if(req.session.user){
    	thisUsername = req.session.user.username;
    }

	database.read(db, "terms", searchQuery, function(searchResult){

		callback({
			status: "success",
			count: searchResult.length,
			body: searchResult
		});
		

	});
}

function getDefinitions(db, req, callback){

	var searchQuery = {
		term: req.body.term,
		removed: false, 
		approved: true
	}

	if(req.body.user && (req.body.user == true || req.body.user == "true")){
		searchQuery = {
			author: req.body.author
		}
	}

	database.read(db, "definitions", searchQuery, function(definitions){

		var ids = [];
		var vote_ids = [];

		var commentQuery;
		var definitionVoteQuery;
		var currentUser;

		definitions.forEach(function(definition){
			ids.push({post_id: definition.id});
			vote_ids.push({post: definition.id});
		})

		if (ids.length){
			commentQuery = {
				removed: false,
				$or: ids
			}

			definitionVoteQuery = {
				$or: vote_ids	,
				type: "definition"
			}

		} else {
			commentQuery = {
				post_id: Date.now()*Math.random()*-1				// this effectively assures an empty search, because we're looking for a negative decimal ID
			}

			voteQuery = {
				post: Date.now()*Math.random()*-1				// this effectively assures an empty search, because we're looking for a negative decimal ID
			}
		}

		if(req.session.user){
			currentUser = req.session.user.username
		} else {
			currentUser = req.headers["X-Forwarded-For"] || req.headers["x-forwarded-for"] || req.client.remoteAddress;
		}

		database.read(db, "comments", commentQuery, function(comments){

			database.read(db, "votes", definitionVoteQuery, function(definitionVotes){

				console.log("Found " + comments.length + " comments for " + definitions.length + " definitions")
				var responsesToReturn = [];

				definitions.forEach(function(definition){

					if(((definition.upvotes - definition.downvotes) >= -5)){

						definition.comments = [];

						var associatedComments = [];

						comments.forEach(function(comment){

							if(comment.post_id == definition.id){

								comment.owner = false;
								comment.term = definition.term

								if(req.session.user && comment.author == req.session.user.username){
									comment.owner = true;
								}

								associatedComments.push(comment);
							}

						})


						// while we're getting these... let's mark definitions authored by the requesting user
						definition.owner = false;

						if(req.session.user && definition.author == req.session.user.username){
							definition.owner = true;
						}

						definition.authorUpvote = false;
						definition.authorDownvote = false;

						definitionVotes.forEach(function(vote){
							if(parseInt(vote.post) == parseInt(definition.id) && vote.author == currentUser){

								if(vote.direction == "up"){
									definition.authorUpvote = true;
								}

								if(vote.direction == "down"){
									definition.authorDownvote = true;
								}

							}
						})
						

						definition.comments = associatedComments;
						responsesToReturn.push(definition);
					}
				})

				callback({
					status: "success",
					count: responsesToReturn.length,
					body: responsesToReturn
				});

			})
		})
	});
}

function logSearch(db, req, callback){

	var userIP = req.headers["X-Forwarded-For"] || req.headers["x-forwarded-for"] || req.client.remoteAddress;
    var thisUsername = null;

    if(req.session.user){
    	thisUsername = req.session.user.username;
    }

    var newSearchRecord = {
		term: req.body.term,
		username: thisUsername,
		ip: userIP,
		date: new Date(),
		termExists: false
	}

	if(thisUsername != "max" && thisUsername != "andrew" && req.body.term.trim().length){		

		var termQuery = { name: req.body.term } // check if this term exists

		database.read(db, "terms", termQuery, function checkForExistingTerm(existingTerms){
		
			// 1. if term exists, update the searched count on it, set search to true
			if(existingTerms.length == 1){

				var termUpdate = { 
					$inc: {
						"searched": 1
					} 
				}

				newSearchRecord.termExists = true;

				database.update(db, "terms", termQuery, termUpdate, function confirmUpdate(result){
					console.log("Search recorded");
				})

			} else if (existingTerms.length == 0 && req.body.term.length > 1){
				logRequestedSearch(db, req.body.term);				// if this term doesn't exist, log as requested
			}

			// either way, a search is created
			database.create(db, "searches", newSearchRecord, function logSearch(loggedSearch){
				callback();
			});


		})

	} else {
		callback();
	}
}

function requestDefinition(db, req, callback){				// if a user clicks "request definition", log it

	/* 
		if the term exists, up the requested count by 10
		if it doesn't, log the request
	*/


	req.body.term = req.body.term.toLowerCase().trim();

	// first, let's check if a request for this term exists

	if(validateInput(req.body.term)){
		if(req.body.term.length >1){


			var userQuery = {
				username: req.session.user.username
			}

			database.read(db, "users", userQuery, function findUser(user){

				if(user.length == 1 && user[0].username != null && user[0].email != null){

					user = user[0];

					console.log(req.session);

					var newEmailRequest = {
						term: req.body.term,
						username: user.username,
						email: user.email,
						date: new Date()
					}

					var newRequest = {
						term: req.body.term.toLowerCase(),
						weight: 50,
						searched: 1,
						manuallyRequested: true,
						version2: true
					}

					var existingRequestQuery = {
						term: req.body.term
					}

					database.read(db, "requests", existingRequestQuery, function checkForExistingRequests(existingRequests){

						if(existingRequests.length > 0){		// if the request exists, increment it
							var requestUpdate = { 
								$inc: {
									"weight": 10,				// we'll increment by 10 for request (maybe 100?) - 1 for search
									"searched": 1
								} 
							}

							database.update(db, "requests", existingRequestQuery, requestUpdate, function confirmUpdate(result){
								console.log("The existing request weight has been incremented by 10");
								callback({status: "success"})
							})
						} else {								// if the request doesn't exist, create it
							database.create(db, "requests", newRequest, function createNewRequest(request){
								console.log("A new request has been created for " + req.body.term);
								callback({status: "success"})
							})
						}

						if(req.session && req.session.user){
							database.create(db, "definitionRequestEmails", newEmailRequest, function createEmailDefinition(response){
								console.log("Email created");
							});
						}
						

					});




				} else {
					callback({
						status: "fail", message: "Please refresh the page and/or log in again."
					})
				}

			})
		} else {
			callback({
				status: "fail", message: "Your definition needs to be at least 2 characters long."
			})
		}
	} else {
		callback({
			status: "fail", message: "No profanity or links, please"
		});
	}

}

function logRequestedSearch(db, term){

	var thisTerm = term;

	term = term.replace(/[^a-zA-Z\d\s:]/g,'');


	/* 
		1. check requested terms collection for this term - use regex to find if this is a subterm of another term
		2. if there are, find the max length term
		3. if it is, up the searches on that term by 1
		4. if it's not, create a new requested term
			--> we should *then* search for smaller terms that match this and delete them, right?
		5. when a term is added, check if a requested term is a subterm of this, delete it
	*/

	var regexSearch = "\^" + term + "\.\*";

	var requestSearchQuery = {
		term: {
			$regex: new RegExp(regexSearch),
		},
		version2: true
	}


	database.read(db, "requests", requestSearchQuery, function getExistingRequests(requests){

		console.log("Term is: " + thisTerm);

		console.log("Found " + requests.length + " request matches for the term: " + thisTerm);

		if(requests.length > 0){

			// if a request exists, update it

			// find the max length term

			var maxLengthTerm = "";

			for(var i = 0; i < requests.length; i++){
				var currentTerm = requests[i].term;
				console.log(i + " - term: " + currentTerm + "; current max length term: " + maxLengthTerm);
				if(currentTerm.length > maxLengthTerm.length)	{	maxLengthTerm = currentTerm }

				if(i == (requests.length-1)) { console.log("the loop is done"); }
			}

			console.log("The max length request is: " + maxLengthTerm);

			var requestQuery = {
				term: maxLengthTerm
			}

			var requestUpdate = { 
				$inc: {
					"searched": 1,
					"weight": 1
				} 
			}

			database.update(db, "requests", requestQuery, requestUpdate, function confirmUpdate(result){
				console.log("Request recorded");
			})
		} else {
			// if a request doesn't exist, create it

			var newRequest = {
				term: term.toLowerCase(),
				weight: 1,
				searched: 1,
				manuallyRequested: false,
				version2: true
			}

			database.create(db, "requests", newRequest, function createRequest(request){
				console.log("A new request has been created");
			})
		}
	})
}


function addDefinition(db, req, callback){
	if(req.session.user){
		if(req.body.definition && req.body.term && (req.body.definition.length <= 750) && (req.body.definition.length >= 30)){

			var userSubmissionsQuery = {
				author: req.session.user.username,
				approved: true,
				removed: false
			}


			console.log("term: " + validateInput(req.body.term));
			console.log("definition: " + validateInput(req.body.definition));

			if(validateInput(req.body.definition) && validateInput(req.body.term)){

				var sanitizedTerm = sanitizeHtml(req.body.term, {
				    allowedTags: [], allowedAttributes: []
				});

				var sanitizedBody = sanitizeHtml(req.body.definition, {
				    allowedTags: [], allowedAttributes: []
				});

				if(sanitizedBody.length && sanitizedTerm.length){
					database.read(db, "definitions", userSubmissionsQuery, function fetchUser(approvedDefinitions){


						var relatedTerms = [];

						// let's make sure the related terms exist and are kosher
						if(req.body.related){
							req.body.related.forEach(function(term){

								var sanitizedTerm = sanitizeHtml(term, {
								    allowedTags: [], allowedAttributes: []
								});

								if(sanitizedTerm.trim().length && validateInput(term)){
									relatedTerms.push(sanitizedTerm.toLowerCase())
								}
							});
						}

						var sanitizedBody = sanitizeInput(req.body.definition);

						var preMarkUpBody = sanitizedBody.replace(/^\#/mg, "").replace(/\`{2,}/g, "\`").replace(/\~\~/g, "").replace(/<a href="/g, "");
						var markedUpBody = converter.makeHtml(preMarkUpBody);

						console.log("markedUpBody");
						console.log(markedUpBody);


						console.log("This user has submitted " + approvedDefinitions.length + " definitions");

						var newDefinitionQuery = {
							id: Math.floor(Date.now()/Math.random()),							// hopefully this should give us a random ID
							term: sanitizedTerm,
							author: req.session.user.username,
							upvotes: 1,
							downvotes: 0, 
							reportCount: 0,
							removed: false,
							approved: false,
							rejected: false,
							lastEdit: new Date(),
							created: new Date(),
							body: sanitizedBody,
							markdown: markedUpBody,
							category: req.body.category,
							related: relatedTerms
						}

						var newVote = {
							post: newDefinitionQuery.id,
							author: newDefinitionQuery.author,
							direction: "up",
							date: new Date(),
							type: "definition"
						}

						var moderator = (req.session.user.admin == "true" || req.session.user.moderator == "true" || req.session.user.admin == true || req.session.user.moderator == true);

						// if((approvedDefinitions.length > 5 || moderator)){			
						if(true){			// all definitions are auto-approved - change at launch!
							console.log("Auto approve based on positive submission history");
							newDefinitionQuery.approved = true;

							var newNotification = {
								to: newDefinitionQuery.author,
								from: "admin",
								date: new Date(),
								body: "Your submission for '" + newDefinitionQuery.term + "' has been approved",
								type: "definition",
								term: newDefinitionQuery.term,
								status: "approved"
							}


							var newNotificationsUpdate = {
								$set: {
									"data.newNotifications": true
								}
							}

							var userQuery = {
								username: newDefinitionQuery.author
							}


							database.create(db, "notifications", newNotification, function createNotification(newNotification){
								database.update(db, "users", userQuery, newNotificationsUpdate, function addNewNotification(newNotification){
									console.log("Notification for auto approval of '" + newDefinitionQuery.term + "' created");
								});
							})

						}

						var termLink = cleanUrl(req.body.term);

						var termSearchQuery = { 
							name: req.body.term,
						}


						var newTermQuery = { 
							name: sanitizedTerm,
							link: termLink,
							searched: 0,
							date: new Date()
						}

						database.read(db, "terms", termSearchQuery, function checkForExistingTerm(existingTerms){

							if(existingTerms.length == 0 && sanitizedTerm.length){
								console.log("creating new definition for the term '" + newTermQuery.name + "'");
								database.create(db, "terms", newTermQuery, function createdTerm(newTerm){
									database.create(db, "definitions", newDefinitionQuery, function createdDefinition(newDefinition){
										console.log(newDefinition.ops[0]);

										emailAboutNewDefinition(db, newDefinition.ops[0].term);


										database.create(db, "votes", newVote, function createdVote(newVote){

											// remove requests for this term 

											var requestUpdateQuery = { term: newDefinition.ops[0].term }

											var requestUpdate = {
												$set: {
													termExists: true
												}
											}

											database.update(db, "requests", requestUpdateQuery, requestUpdate, function updateRequests(response){
												callback({
													status: "success",
													termAdded: newDefinitionQuery.approved,
													term: newDefinition.ops[0].term
												});
											})
										});
									});
								});
							} else if (existingTerms.length == 1) {
								console.log("Someone has already created the term '" + termSearchQuery.name + "'");

								// we need to either create  a new id or update an existing one, depending on whethere there's an ID
									
								if(parseInt(req.body.id) == 0){

									database.create(db, "definitions", newDefinitionQuery, function createdDefinition(newDefinition){
										console.log(newDefinition.ops[0]);
										
										emailAboutNewDefinition(db, newDefinition.ops[0].term);

										database.create(db, "votes", newVote, function createdVote(newVote){
											callback({
												status: "success",
												termAdded: newDefinitionQuery.approved,
												term: newDefinition.ops[0].term
											});
										});
									});
								} else {

									var definitionUpdateQuery = {
										id: parseInt(req.body.id)
									}

									var updatedDefinition = {
										$set: {
											lastEdit: new Date(),
											body: req.body.definition,
											markdown: markedUpBody,
											category: req.body.category,
											related: relatedTerms
										}
									}

									database.update(db, "definitions", definitionUpdateQuery, updatedDefinition, function updateDefinition(updatedDefinition){
										console.log("updatedDefinition");
										console.log(updatedDefinition);

										

										callback({
											status: "success",
											termAdded: false,
											term: updatedDefinition.term
										});
									});
								}

							} else {
								console.log("Hmm, found multiple instances of the same term");
								callback({
									status: "fail",
									message: "Hmm, found multiple instances of the same term"
								});
							}
						})

					})
					
				} else {
					callback({
						status: "fail",
						message: "Please enter a term and a definition"
					});
				}

			} else {
				callback({
					status: "fail",
					message: "No profanity, links, or scripts, please"
				});
			}
		} else {
			callback({
				status: "fail",
				message: "A new post must have a term and a definition between 30 and 750 characters."
			});
		}
	} else {
		callback({
			status: "fail",
			message: "You must log in to add a definition"
		});
	}
}


function addComment(db, req, callback){
	if(req.session.user){

		var sanitizedComment = sanitizeHtml(req.body.commentBody, {
		    allowedTags: [], allowedAttributes: []
		});


		if(sanitizedComment){
			if(validateInput(sanitizedComment)){
				// search for identical comments or comments made within the last 5 mins

				var duplicateCommentQuery = {
					author: req.session.user.username,
					post_id: parseInt(req.body.post_id)
				}

				database.read(db, "comments", duplicateCommentQuery, function checkExistingComments(existingComments){

					var commentApproved = true;
					var errorMessage = ""

					existingComments.forEach(function(existingComment){

						var timeLimit = 1000 * 60 * 5;			// how often can users make comments? Let's say every 5 mins (consider making random for bots?)


						console.log("Date calculation: "); 
						console.log(Date.now() - Date.parse(existingComment.date) - timeLimit);

						if(Date.parse(existingComment.date) + timeLimit >= Date.now()){
							commentApproved = false;
							errorMessage = "Please wait a few minutes before posting another comment";
							console.log(errorMessage);
						}

						if(existingComment.body.trim() == sanitizedComment.trim()){
							commentApproved = false;
							errorMessage = "You've already posted this comment";
							console.log(errorMessage);
						}
					});

					if(commentApproved){

						var definitionQuery = {
							id: parseInt(req.body.post_id)
						}

						database.read(db, "definitions", definitionQuery, function fetchDefinition(definitions){
							if(definitions.length == 1){
								var newCommentQuery = {
									id: Math.floor(Date.now()/Math.random()),							// hopefully this should give us a random ID
									term: definitions[0].term,
									post_id: parseInt(req.body.post_id),
									author: req.session.user.username,
									upvotes: 0,
									downvotes: 0, 
									reportCount: 0,
									removed: false,
									approved: true,
									rejected: false,
									date: new Date(),
									body: sanitizedComment
								}



								database.create(db, "comments", newCommentQuery, function createComment(newComment){
									var thisMessage = "Someone has commented on your definition: " + definitions[0].term;
									
									createNotification(db, req, definitions[0].author, thisMessage, definitions[0].term, "approved", "new-comment", function addNotification(){
										console.log("Notification created");	
									})

									callback({
										status: "success",
										comment: newComment.ops[0]
									});
								});


							} else {
								callback({ status: "fail", message: "No corresponding definition found" });
							}
						})

					} else {
						callback({ status: "fail", message: errorMessage });
					}
				});
			} else {
				callback({ status: "fail", message: "No profanity, links, or scripts please" });
			}

		} else {
			callback({ status: "fail", message: "This comment is empty" });
		}
	} else {
		callback({ status: "fail", message: "You must log in to add a definition" });
	}
}


function getComments(db, req, callback){

	searchQuery = {
		post_id: parseInt(req.body.id),
		removed: false
	}


	if(req.body.user && (req.body.user == true || req.body.user == "true")){
		var searchQuery = {
			author: req.body.author,
			removed: false, 
			approved: true
		}
	}	

	database.read(db, "comments", searchQuery, function(searchResult){

		console.log(searchResult);

		var responsesToReturn = [];

		searchResult.forEach(function(oneResult){
			if((oneResult.upvotes - oneResult.downvotes) >= -5){
				
				// Let's mark definitions authored by the requesting user
				oneResult.owner = false;

				if(req.session.user && oneResult.author == req.session.user.username){
					console.log("THIS ONE BELONGS TO THE OWNER");
					oneResult.owner = true;
				}

				responsesToReturn.push(oneResult);
			}
		})

		callback({
			status: "success",
			count: responsesToReturn.length,
			body: responsesToReturn
		});

	});
}


function vote(db, req, callback){

	/* 
		1. check if there's already a vote for this user for this term
		2. if there is, remove it, and create a new one (easier than changing direction)
		3. if there isn't, create the vote
		4. update term
	*/


	var voter;

	if(req.session.user){
		voter = req.session.user.username
	} else {
		voter = req.headers["X-Forwarded-For"] || req.headers["x-forwarded-for"] || req.client.remoteAddress;
	}

	var postName = parseInt(req.body.id);

	var postQuery = {
		id: parseInt(req.body.id)
	}

	database.read(db, "definitions", postQuery, function fetchPost(post){

		if(post.length == 1 && req.body.type == "definition"){
			postName = post[0].term;
		}

		var voteQuery = {
			post: parseInt(req.body.id),
			author: voter,
			type: req.body.type
		}

		var newVote = {
			post: parseInt(req.body.id),
			term: postName,
			author: voter,
			direction: req.body.direction,
			date: new Date(),
			type: req.body.type
		}

		database.read(db, "votes", voteQuery, function checkForExistingVote(existingVotes){

			console.log("Existing votes");

			console.log(existingVotes);
			console.log("=========");

			if(existingVotes.length == 0){
				console.log("no votes")
				createNewVote(db, req, newVote, callback);
			} else if (existingVotes.length == 1){

				console.log("one vote");

				if(req.body.type == "definition" || req.body.type == "comment"){
					thisVoteCollection = req.body.type + "s";

					if(existingVotes[0].direction != newVote.direction){

						// if vote already recorded in a different direction, remove it and create a new one in the right direction (ex: remove upvote, create downvote)

						database.remove(db, "votes", voteQuery, function removeVote(removedVote){

							var voteChange;

							if(newVote.direction == "up"){
								voteChange = "downvotes";
							} else {
								voteChange = "upvotes"
							}

							var definitionQuery = {
								id: voteQuery.post
							}

							var definitionUpdateQuery = {
								$inc: {}
							};

							definitionUpdateQuery.$inc[voteChange] = -1;

							database.update(db, thisVoteCollection, definitionQuery, definitionUpdateQuery, function updateDefinition(newDefinition){
								createNewVote(db, req, newVote, callback);
							})
						})

					} else {
						// if vote already recorded in the same direction, remove it (if upvoting after already upvoting, remove upvote)
						console.log("vote already recorded");
						database.remove(db, "votes", voteQuery, function removeVote(removedVote){

							var voteChange = newVote.direction + "votes";

							var definitionQuery = {
								id: voteQuery.post
							}

							var definitionUpdateQuery = {
								$inc: {}
							};

							definitionUpdateQuery.$inc[voteChange] = -1;

						
							database.update(db, thisVoteCollection, definitionQuery, definitionUpdateQuery, function updateDefinition(newDefinition){
								newDefinition.changedVote = false;
								console.log("newDefinition")
								callback({status: "success", message: "vote created", updatedDefinition: newDefinition});
							})
						})
					}
				} else {
					console.log("ERROR! The type of vote is incorrect");
					callback({status: "fail", message: "The type of vote is incorrect"});
				}
				
				
			} else {
				callback({status: "fail", message: "Something went wrong"});
			}
		});
	})

}

function createNewVote(db, req, newVote, callback){

	database.create(db, "votes", newVote, function createVote(newVote){

		var voteChange;

		if(newVote.ops[0].direction == "up"){
			voteChange = "upvotes";
		} else {
			voteChange = "downvotes"
		}

		var definitionQuery = {
			id: newVote.ops[0].post
		}

		var definitionUpdateQuery = {
			$inc: {}
		};

		definitionUpdateQuery.$inc[voteChange] = 1;

		console.log("definitionUpdateQuery");
		console.log(definitionUpdateQuery);

		if(req.body.type == "definition" || req.body.type == "comment"){
			
			thisVoteCollection = req.body.type + "s";

			database.update(db, thisVoteCollection, definitionQuery, definitionUpdateQuery, function updateDefinition(newDefinition){
				console.log("newDefinition");
				console.log(newDefinition);
				newDefinition.changedVote = true;
				callback({status: "success", message: "vote created", updatedDefinition: newDefinition});
			})
		} else {
			callback({status: "fail", message: "invalid type of vote"});
		}
			
	})
}


function adminVote(db, req, callback){

	console.log("req.body");
	console.log(req.body);
	if(req.body.post == "definition"){

		var definitionQuery = {
			id: parseInt(req.body.id)
		}

		var definitionUpdateQuery = {
			$set: {}
		}

		if(req.body.type == "approved" || req.body.type == "rejected"){
			definitionUpdateQuery.$set[req.body.type] = true;
		}

		var newNotification = {
			to: req.body.author,
			from: "admin",
			date: new Date(),
			body: "Your submission for '" + req.body.term + "' has been " + req.body.type,
			type: "definition",
			term: req.body.term,
			status: req.body.type
		}

		var newNotificationsUpdate = {
			$set: {
				"data.newNotifications": true
			}
		}

		

		database.update(db, "definitions", definitionQuery, definitionUpdateQuery, function updateDefinition(updatedDefinition){
			database.create(db, "notifications", newNotification, function createNotification(newNotification){
				
				console.log("updatedDefinition");
				console.log(updatedDefinition);

				var userQuery = {
					username: updatedDefinition.author
				}


				database.update(db, "users", userQuery, newNotificationsUpdate, function addNewNotification(newNotification){
					callback({status: "success", message: "definition updated"});
				});
			})
		})

	} else if (req.body.post == "report"){

		var reportQuery = {
			id: parseInt(req.body.id),
			author: req.body.author
		}

		var thisDecision = "report dismissed";

		if(req.body.type == "approved")	{ thisDecision == "post removed"}

		var reportUpdateQuery = {
			$set: {
				resolved: true,
				decision: thisDecision
			}
		}

		database.update(db, "reports", reportQuery, reportUpdateQuery, function resolveReport(updatedReport){

			var postQuery = {
				id: updatedReport.post_id
			}

			var postUpdateQuery = {
				$set: {
					removed: true
				}
			}

			if(req.body.type == "approved"){
				console.log("approving report - removing post");
				database.update(db, updatedReport.type, postQuery, postUpdateQuery, function removePost(updatedPost){

						var thisType = updatedReport.type.substr(0, (updatedReport.type.length-1))

						var newNotification = {
							to: updatedPost.author,
							from: "admin",
							date: new Date(),
							body: "Your comment has been removed",
							type: thisType,
							status: "removed"
						}

						var remainingDefinitionQuery = {
							removed: false,
							approved: true,
							term: updatedPost.term
						}


						database.read(db, "definitions", remainingDefinitionQuery, function(definitions){

							console.log("There are " + definitions.length + " definitions left for this term");

							if(definitions.length == 0){			// if there are no definitions left, let's delete the term

								var termQuery = {
									name: updatedPost.term
								}

								database.remove(db, "terms", termQuery, function(message){
									console.log(message);
								})

							}

							var userQuery = {
								username: updatedPost.author
							}

							database.read(db, "users", userQuery, function getUsers(users){

								if(users.length == 1){
									// email user about this

									var emailBody = "<p>Hey " +  updatedPost.author + ",<br><br>Max from Hackterms here. Our small team of moderators routinely reviews new definitions, and has unfortunately made the decision to remove your submission for '"  + updatedPost.term + "'. This happened because your post violates one of our rules, which you can find here: <a href = 'https://www.hackterms.com/darules'>Hackterms Rules</a>.<br><br>I really appreciate the time you took to contibute a definition, and I hope you review the rules and make another submission! Finally, if you're still confused about why your definition was removed or have any questions, don't hesitate to reply to this email.<br><br><br>Thanks a lot, and happy coding!<br></p>-Max";


									var mailOptions = {
									    from: 'Hackterms <hello@hackterms.com>',
									    to:  users[0].email, 
									    subject: 'Your submission has been removed', 
									    text: "Hey " + updatedPost.author + "\n\n, Max from Hackterms here. Our small team of moderators routinely reviews new definitions, and has unfortunately made the decision to remove your submission for '"  + updatedPost.term + "'. This happened because your post violates one of our rules, which you can find here: https://www.hackterms.com/darules" + "\n\n I personally really appreciate the time you took to contibute a definition, and I hope you review the rules and make another submission! Finally, if you're still confused about why your submission was removed or have any questions, don't hesitate to reply to this email.\n\n Thanks a lot, and happy coding!\n\n-Max",
									    html: emailBody
									};

									transporter.sendMail(mailOptions, function(error, info){
									    if(error){
									        console.log(error);
									    } else {
									        console.log('Message sent: ' + info.response);
									        callback({status: "success", message: "If we have your email on file, you will receive an instructions to reset your password shortly!"});
									    };
									});


								} else {
									console.log("Trouble fetching users");
								}
							})
						})

						if(updatedReport.type == "definitions"){
							console.log("THIS IS A DEFINITION");
							newNotification.body = "Your submission for '" + updatedPost.term + "' has been removed";
							newNotification.term = updatedPost.term;
						}


						var newNotificationsUpdate = {
							$set: {
								"data.newNotifications": true
							}
						}

						var userQuery = {
							username: updatedPost.author
						}


						console.log("newNotification");
						console.log(newNotification);

						database.create(db, "notifications", newNotification, function createNotification(newNotification){		
							database.update(db, "users", userQuery, newNotificationsUpdate, function notifyUser(updatedUser){		
								callback({status: "success", message: "Successfully removed " + thisType});
							});
						});
				});

			} else {
				console.log("post looks good, no removal.");
				callback({status: "success", message: "post looks good, no removal."});
			}
		})

	} else if(req.body.post == "comment"){

				// add how things go here
	
	} else {
		callback({status: "fail", message: "Something went wrong"});
	}
}

function addReport(db, req, callback){

	var postQuery = {
		id: parseInt(req.body.id)
	}

	var thisAuthor;

	if(req.session.user){
		thisAuthor = req.session.user.username;
	} else {
		thisAuthor = req.headers["X-Forwarded-For"] || req.headers["x-forwarded-for"] || req.client.remoteAddress;
	}


	if(req.body.type == "comments" || req.body.type == "definitions"){

		var reportQuery = {
			post_id: parseInt(req.body.id),
			author: thisAuthor,
			resolved: false
		}

		database.read(db, "reports", reportQuery, function checkForExistingReports(existingReports){

			console.log("existing reports: " + existingReports.length);

			if(existingReports.length == 0){
				database.read(db, req.body.type, postQuery, function fetchProblematicPost(post){
					if(post.length == 1){

						var thisReport = {
							id: Date.now()*(Math.floor(Math.random()*100)),
							created: new Date(),
							resolved: false,
							decision: null,
							reason: req.body.reason,
							author: thisAuthor,
							post_id: post[0].id,
							type: req.body.type,
							term: post[0].term,
							body: post[0].body
						}

						database.create(db, "reports", thisReport, function createReport(newReport){

							var postUpdateQuery = {
								$inc: {
									reportCount: 1
								}
							}

							database.update(db, req.body.type, postQuery, postUpdateQuery, function updatePost(post){
								callback({status: "success", message: "Report created"});
							})	
						})
					} else {
						callback({status: "fail", message: "Invalid post"});
					}
				})

			} else {
				callback({status: "fail", message: "You've already submitted a report for this post."});
			}

		})
	} else {
		callback({status: "fail", message: "Invalid report type"});
	}
}


function signup(db, req, callback){

	if(req.body.username.trim().length && req.body.password.trim().length){    	// let's make sure the username and password aren't empty
		if(req.body.username.trim().length && req.body.password.trim().length > 5){    
			if(req.body.username.replace(/\s/g, '').length == req.body.username.length){
				if(req.body.email.trim().length && req.body.email.indexOf("@") != -1 && req.body.email.indexOf(".") != -1){

					if(commonPasswords.indexOf(req.body.password.trim()) == -1){
						
						// check if either this email or username exists

						var userEmailQuery = { email: req.body.email.trim().toLowerCase() }
						var userUsernameQuery = { username: req.body.username.trim().toLowerCase() }

						if(validateCharset(req.body.username)){
							database.read(db, "users", userEmailQuery, function(existingEmailUsers){
								if(existingEmailUsers.length == 0){	
									database.read(db, "users", userUsernameQuery, function(existingUsernameUsers){
										
										if(existingUsernameUsers.length == 0){	
											bcrypt.genSalt(10, function(err, salt) {
											    bcrypt.hash(req.body.password, salt, function(err, hash){
											    	createNewUser(hash, null, null, req.body.email.trim().toLowerCase(), db, req, function(newUser){
														callback({status: "success", message: "Account created. Go ahead and log in!", user: newUser});
														// login(db, req, callback)
													})  
											    });
											});

										} else {	
											callback({status: "fail", message: "That username is not available", errorType: "username"})
										}	
									});
								} else {	
									callback({status: "fail", message: "That email is not available", errorType: "email"})
								}
							})
						} else {
							callback({status: "fail", message: "Please only use letters, numbers, or: _ - . ", errorType: "username"});
						}
					} else {
						callback({status: "fail", message: "Do you want to get hacked? Because that's how you get hacked.", errorType: "password"});
					}
				} else {
					callback({status: "fail", message: "This is not a valid email", errorType: "email"});
				}
			} else {
				callback({status: "fail", message: "No spaces in the username, please", errorType: "username"});
			}
		} else {
			callback({status: "fail", message: "Password must be 6 characters or longer", errorType: "password"});
		}
	} else {
		callback({status: "fail", message: "Username an password can't be blank", errorType: "username"})
	}
}

function login(db, req, callback){
	if(req.body.username.trim().length && req.body.password.trim().length){    	// let's make sure the username and password aren't empty 

		console.log(req.body);

		var userQuery = {
            username: req.body.username.toLowerCase(),
        }	

		database.read(db, "users", userQuery, function checkIfUserExists(existingUsers){
			if(existingUsers.length == 1){	

				var thisUser = existingUsers[0];

				if(thisUser.googleId == null || thisUser.googleId == "null"){			// will need to add github as well

					bcrypt.compare(req.body.password, existingUsers[0].password, function(err, res) {
						if(res){													// if the two password hashes match...
							
							logUserIn(thisUser, db, req, function(response){
								callback(response);
							})
						} else {
							req.session.user = null;
							callback({status: "fail", message: "Login or password are incorrect", errorType: "username"})
						}
					});	
				} else {
					req.session.user = null;
					callback({status: "fail", message: "Please log in with your Google account.", errorType: "username"})
				}
			} else {
				req.session.user = null;
				callback({status: "fail", message: "Login or password are incorrect", errorType: "username"})
			}
		});

	} else {
		callback({status: "fail", message: "Username is blank", errorType: "username"})
	}
}

function googleLogin(db, req, callback){

	client.verifyIdToken(
	    req.body.idtoken,
	    "285224215537-l5a1ol101rmutrvbcd2omt5r3rktmh6v.apps.googleusercontent.com", 
	    function(e, login) {
	      	var payload = login.getPayload();

	      	console.log("payload");
			console.log(payload);
	      	var userid = payload["sub"];
	 
	      	// now we need to check if this userID exists in our database...

      		/* 
				1. does a user with this email exist?
					if yes, does this user have a google id?
						if yes, validate id, then sign in
						if no, send error to log in with password
					if no, create a user accoun with google ID
						sign in
		  	*/

		  	// What happens if our token is invalid?

	      	var userQuery = {
	            email: payload["email"]
	        }	

	        database.read(db, "users", userQuery, function checkIfUserExists(existingUsers){
				if(existingUsers.length == 1){

					// if this user exists, let's try to log the user in

					var thisUser = existingUsers[0];

					if(typeof(thisUser.googleId) != "undefined" && thisUser.googleId != null){
						console.log("this IS a Google user");
						if(thisUser.googleId == userid){
							logUserIn(thisUser, db, req, function(response){
								callback(response);
							})
						} else {
							req.session.user = null;
							callback({status: "fail", message: "You are not who you appear to be", errorType: "username"})
						}
					} else {
						console.log("this isn't a Google user");
						req.session.user = null;
						callback({status: "fail", message: "Please log in with your username and password", errorType: "username"})
					}
				} else if (existingUsers.length == 0) {
					
					// if this user doesn't exist, let's try to create an account

					createNewUser(null, userid, null, userQuery.email, db, req, function(newUser){
						callback({status: "success", message: "Account created. Go ahead and log in!", user: newUser});
					})
				} else {
					callback({status: "fail", message: "Something really weird happened", errorType: "username"})
				}

			})
	 });
}

function githubLogin(db, req, thisCode, callback){

	console.log("running github login from dbops");

	var u = 'https://github.com/login/oauth/access_token'					// build URL to request token
       + '?client_id=' + "029b90872503557c3d0e"
       + '&client_secret=' + process.env.GITHUB_SECRET
       + '&code=' + thisCode

	request.get({url: u, json: true}, function (error, apiRes, body){
		
		console.log("got a response");
		console.log("body");
		console.log(body);
		var access_token = body.access_token;

		if (error) {
			console.log("error");
	        console.log(error)
	        callback({status: "fail", message: "Github error", errorType: "username"})
	    } else {
	    	console.log("got a token!");
	    	console.log("access_token:" + access_token);

	    	var profileUrl = "https://api.github.com/user?access_token=" + access_token;			// get basic user profile
	    	var emailUrl = "https://api.github.com/user/emails?access_token=" + access_token;		// get user emails

	    	var profileHeaders = {
	    		"User-Agent": "Hackterms"
	    	}

	    	// get token from github and request user profile info

	    	if(typeof(access_token) != "undefined"){



		    	request.get({url: profileUrl, headers: profileHeaders, json: true}, function (error, apiRes, userBody){
		    		if (error) {
						console.log("error");
				        console.log(error)
				        callback({status: "fail", message: "Github error", errorType: "username"})
				    } else {
			    		console.log("here's the user:");
			    		console.log(userBody);
			    		// callback({status: "success", message: "Account created. Go ahead and log in!"});

			    		/* from here on, we try to log the user in */

			    		if(typeof(userBody.id) != "undefined" && userBody.message != 'Bad credentials'){ 

					    	request.get({url: emailUrl, headers: profileHeaders, json: true}, function (error, apiRes, emailBody){

					    		if(emailBody.message != "Not Found"){

					    			console.log("email body:");
						    		console.log(emailBody);

						    		var thisEmail = emailBody[0]["email"];

						    		console.log("thisEmail: " + thisEmail);

						    		var userQuery = {
							            email: thisEmail
							        }	

							        console.log(userQuery);

							        var userid = userBody.id;

							        database.read(db, "users", userQuery, function checkIfUserExists(existingUsers){
										
							        	console.log("existingUsers.length: " + existingUsers.length);

										if(existingUsers.length == 1){

											// if this user exists, let's try to log the user in

											var thisUser = existingUsers[0];

											if(typeof(thisUser.githubId) != "undefined" && thisUser.githubId != null){
												console.log("this IS a Github user");
												if(thisUser.githubId == userid){
													logUserIn(thisUser, db, req, function(response){
														callback({status: "logged in"});
													})
												} else {
													req.session.user = null;
													callback({status: "fail", message: "You are not who you appear to be", errorType: "username"})
												}
											} else {
												console.log("this isn't a Github user");
												req.session.user = null;
												callback({status: "fail", message: "Please log in with your username and password or Google account", errorType: "username"})
											}
										} else if (existingUsers.length == 0) {
											
											// if this user doesn't exist, let's try to create an account

											createNewUser(null, null, userid, thisEmail, db, req, function(newUser){
												callback({status: "account created", message: "Account created. Go ahead and log in!", user: newUser});
											})
										} else {
											callback({status: "fail", message: "Something really weird happened", errorType: "username"})
										}

									}) 

					    		} else {
					    			callback({status: "fail", message: "Github email error. Sorry!"})
					    		}

						    });
						} else {
			    			callback({status: "fail", message: "Invalid Github credentials. Try creating or logging in with a regular email account."})
			    		}
		    		}
		    	});
		    } else {
		    	callback({status: "fail", message: "Bummer - invalid access token. Refresh and try again."});
		    }
	    }
	});


}


function logUserIn(thisUser, db, req, callback){
	if(thisUser.suspended == "false" || thisUser.suspended == false){

		var userQuery = {
			username: thisUser.username
		}

		var loginDateUpdate = {
			$set: {
				lastLoggedOn: new Date()
			}
		}

		database.update(db, "users", userQuery, loginDateUpdate, function updateLastLogin(lastLogin){

			console.log("Logged in successfully.")
            req.session.user = thisUser.data;
            req.session.user.admin = thisUser.admin;
            req.session.user.moderator = thisUser.moderator;
            req.session.user.email = thisUser.email;

            var day = 60000*60*24;

            if(req.body.rememberMe == "true" || req.body.rememberMe == true){
            	req.session.cookie.expires = new Date(Date.now() + (14*day));
            	req.session.cookie.maxAge = (14*day);                           // this is what makes the cookie expire
            }

            callback({status: "success", message: "Logged in", errorType: "username"});

		})
	} else {
		req.session.user = null;
		callback({status: "fail", message: "Your account has been suspended", errorType: "username"})
	}
}

function createNewUser(hash, thisGoogleId, thisGithubId, thisEmail, db, req, callback){

	var thisUsername = null;
	if(hash != null && thisGoogleId == null && thisGithubId == null){
		thisUsername = req.body.username.trim().toLowerCase();
	}

	var newUser = {
		createdOn: new Date(),
		email: thisEmail,
		username: thisUsername,
        password: hash,
        googleId: thisGoogleId,
        githubId: thisGithubId,
        lastLoggedOn: new Date(),
        suspended: false,
        admin: false,
        moderator: false,
			data: {
				username: thisUsername,
				newNotifications: false,
				badges: {
					topContributor: false,		// top 5% of contributions?
					professor: false,			// added 10+ definitions
					og: false, 					// first 50 contributors
					cunningLinguist: false,		// added 10+ comments
					gottaCatchThemAll: false	// added a definition in every category
				}

			}
    }
																
	database.create(db, "users", newUser, function(newlyCreatedUser){
		callback(newlyCreatedUser[0]);
	});     
}


/* TERM FUNCTIONS */

function getTopTerms(db, req, callback){

//	 var requestQuery = { termExists: false } 

	var requestQuery = { version2: true } 
	var orderQuery = { searched: -1 }
	var weightQuery = { weight: -1 }

	database.sortRead(db, "terms", {}, orderQuery, function getSearches(allSearches){
		var topSearches = allSearches.splice(0, 10);

		database.sortRead(db, "requests", requestQuery, weightQuery, function getSearches(allRequests){
			var topRequests = allRequests.splice(0, 10);


			var response = {
				topRequests: topRequests,
				topSearches: topSearches
			}

			callback(response);
		})
	})
}

function getAllTerms(db, req, callback){	

	console.log("getting all terms");
	var sortQuery = {name: 1}

	database.sortRead(db, "terms", {}, sortQuery, function getTerms(result){
        callback({terms: result});
    });
}


function getEmptyTerms(db, req, callback){

	var definitionQuery = {
		removed: false,
		rejected: false,
		approved: true
	}

	database.read(db, "definitions", definitionQuery, function fetchAllDefinitions(definitions){
		console.log("Got " + definitions.length + " definitions");

		for(var i = 0; i < definitions.length; i++){
			var definition = definitions[i];
			createTermFromDefinition(db, req, i, definition);
		}
	})
}

function getRandomTerm(db, req, callback){


	database.read(db, "terms", {}, function(allTerms){

		if(allTerms.length){

			var randomNumber = Math.floor(Math.random()*allTerms.length);
			var randomTerm = allTerms[randomNumber].name;

			if(typeof(randomTerm) == "undefined" || randomTerm == null){
				randomTerm = ""
			}
			callback(randomTerm);
		} else {

			callback("");
		}

	})
	
}

function getTopRequests(db, req, callback){
	var requestQuery = { termExists: false }
	var orderQuery = { searched: -1 }
}


function logVisit(db, req, callback){

	var userIP = req.headers["X-Forwarded-For"] || req.headers["x-forwarded-for"] || req.client.remoteAddress;
    var thisUsername = null;

    var fullDate = new Date();

    if(req.session.user){
    	thisUsername = req.session.user.username
    }

    var newVisit = {
    	username: thisUsername,
    	date: fullDate,
    	ip: userIP,
    	page: req.url
    }

    var ignoredUrls = ["/get-definitions", "/search", "/metrics", "/updated-user-data", "/log-search", "/login", "/robots.txt", "/password-reset", "/darules"]
    var ignoredISP = ["Googlebot", "Amazon.com", "YANDEX LLC", "Yandex", "Rostelecom"];



    if(ignoredUrls.indexOf(req.url) == -1 && thisUsername != "max" && thisUsername != "andrew"){

    	console.log("userIP: " + userIP);

    	request({
		    url: "http://ip-api.com/json/" + userIP,
		    json: true
		}, function (error, response, body) {
			
		    if (!error && response.statusCode === 200) {

			    var location = {
			    	city: body.city,
			    	country: body.country,
			    	isp: body.isp,
			    	regionName: body.regionName,
			    	zip: body.zip
			    }

			    newVisit.location = location;

		    	if(ignoredISP.indexOf(newVisit.location.isp) == -1){

			        database.create(db, "visits", newVisit, function recordLogin(){
				    	callback();
				    })
			    } else {
			    	callback();
			    }
		    } else {
		    	callback();
		    }
		})
    	
    } else {
    	console.log("no need to log that page");
    	callback();
    }

    
}

function getUpdatedUser(db, req, callback){

	var userQuery = {
        username: req.session.user.username.toLowerCase()
    }	

	database.read(db, "users", userQuery, function fetchUser(existingUser){
		if(existingUser.length == 1){
			console.log("Fetching updated user data");
			req.session.user = existingUser[0].data;
            req.session.user.admin = existingUser[0].admin;
            req.session.user.moderator = existingUser[0].moderator;
			
            if(existingUser[0].suspended == true || existingUser[0].suspended == "true"){
            	callback(true);
            } else {
            	callback(false);
            }
		} else {
			req.session.user = null;
			console.log("Something went wrong with fetching the session");
			callback(false);
		}
	});
}



function getAdminData(db, req, callback){
	if(req.session.user.admin || req.session.user.moderator){    	

		var unapprovedDefinitionsQuery = {
			approved: false,
			rejected: false
		}

		var unresolvedReportsQuery = {
			resolved: false
		}

		database.read(db, "definitions", unapprovedDefinitionsQuery, function getUnapprovedDefinitions(unapprovedDefinitions){
			database.read(db, "reports", unresolvedReportsQuery, function getUnresolvedReports(unresolvedReports){
				callback({definitions: unapprovedDefinitions, reports: unresolvedReports})
			})
		})
		
	} else {
		callback({status: "fail", message: "Not an admin"})
	}
}




function getMetrics(db, req, callback){	


	var userQuery = {};
	var searchQuery = {};
	var visitsQuery = {};

	var searchSort = {
		date: -1
	}

	var dateSort = {
		created: -1
	}

	var approvedDefinitionQuery = {
		removed: false,
		rejected: false,
		approved: true
	}

	var unapprovedDefinitionQuery = {
		rejected: false, 
		approved: false
	}

	var termCountQuery = {
	}

	database.read(db, "users", userQuery, function getUsers(userList){
	
		database.sortRead(db, "definitions", approvedDefinitionQuery, dateSort, function getApprovedDefinitionCount(approvedDefs){
			// database.read(db, "definitions", unapprovedDefinitionQuery, function getUnapprovedDefinitionCount(unapprovedDefs){					
				database.count(db, "terms", termCountQuery, function getTermCount(thisTermCount){
					var thisUserCount = userList.length;

					callback({
						userCount: thisUserCount,
						users: userList,
						approvedDefinitions: approvedDefs,
						unapprovedDefinitions: [],			// later, if there's ever a submission process, we should actually fetch unapproved searches
						termCount: thisTermCount
					})
				})
			// })
		})
	
	})
}


function getAnalytics(db, req, callback){


	/*
		1. fetch all search records from 7 days ago to now
		2. for each day starting 7 days ago (iterate...)
			a. if a date is on that day, count it
		3. 

	*/

	// 7 days ago: 7 * 24 * 60 * 60 * 1000



	var numDays = Math.floor(parseInt(req.body.days));

	console.log("num days: " + numDays); 

	var searchQuery = {
		"date": { 
			$gte: new Date((new Date().getTime() - (numDays * 24 * 60 * 60 * 1000)))
		}
	}

	console.log("searchQuery");
	console.log(searchQuery);

	var approvedDefinitionQuery = {
		removed: false,
		rejected: false,
		approved: true,
		"created": { 
			$gte: new Date((new Date().getTime() - (numDays * 24 * 60 * 60 * 1000)))
		}
	}

	var dateSort = {
		created: -1
	}

	database.read(db, "searches", searchQuery, function getSearches(lastWeekSearches){
		database.sortRead(db, "definitions", approvedDefinitionQuery, dateSort, function getApprovedDefinitionCount(approvedDefs){

			console.log("approvedDefs " + approvedDefs.length);

			var countOfSearches = getItemsByDay(lastWeekSearches, "date", numDays);
			var countOfNewDefinitions = getItemsByDay(approvedDefs, "created", numDays);

			callback({
				searchCount: countOfSearches,
				newDefinitionCount: countOfNewDefinitions
			})
		});
	});
}



function getUserRoles(db, req, callback){
	if(req.session.user.admin){    	

		var userQuery = {
			username: req.body.username
		}

		database.read(db, "users", userQuery, function getUserRoles(user){
			if(user.length == 1){

				var userRoles = {
					admin: user[0].admin,
					moderator: user[0].moderator,
					suspended: user[0].suspended
				}

				callback({status: "success", message: "Got the user roles", roles: userRoles})


			} else {
				callback({status: "fail", message: "That's not a valid user"})
			}
		})
		
	} else {
		callback({status: "fail", message: "Not an admin"})
	}
}

function updateUserRoles(db, req, callback){
	if(req.session.user.admin){    	

		userQuery = {
			username: req.body.username
		}

		userUpdateQuery = {
			$set: {
				moderator: req.body.moderator,
				admin: req.body.admin,
				suspended: req.body.suspended
			}
		}

		database.update(db, "users", userQuery, userUpdateQuery, function updateUser(user){

			var updatedUserRoles = {
				admin: user.admin,
				moderator: user.moderator,
				suspended: user.suspended
			}


			callback({status: "success", 
				message: "Updated the user role", roles: updatedUserRoles})
		})  
		
	} else {
		callback({status: "fail", message: "Not an admin"})
	}
}

function getUserData(db, req, user, callback){

		var userQuery = {
			username: user
		}

		var commentQuery = {
			author: user, 
			removed: false
		}

		var definitionQuery = {
			author: user,
			approved: true,
			removed: false,
			rejected: false
		}

		var notificationQuery = {
			to: user
		}

		if(req.session.user && ((req.session.user.username == user) || req.session.user.moderator || req.session.user.admin)){
			definitionQuery = {
				author: user
			}
		} else {		
			console.log("User is not logged in - only fetching approved definitions");	
		}

		database.read(db, "users", userQuery, function checkIfUserExists(user){
			if(user.length == 1){

				console.log("Requesting user is logged in and " + userQuery.username + " is a real user");

				database.read(db, "definitions", definitionQuery, function fetchDefinitions(allDefinitions){
					database.read(db, "comments", commentQuery, function fetchComments(allComments){
						database.read(db, "notifications", notificationQuery, function fetchNotifications(allNotifications){
							callback({status: "success", definitions: allDefinitions, notifications: allNotifications, comments: allComments})
						})
					})
				})

			} else {
				callback({status: "fail", message: "That's not a real user"})
			}
		})
		

}

function clearNotifications(db, req, callback){
	if(req.session.user){    	

		var userQuery = {
			username: req.session.user.username
		}

		var newNotificationsUpdate = {
			$set: {
				"data.newNotifications": false
			}
		}

		database.update(db, "users", userQuery, newNotificationsUpdate, function updateNotification(updatedNotification){
			callback({status: "success"})
		})
		
	} else {
		callback({status: "fail", message: "User is not logged in"})
	}
}

function deletePost(db, req, callback){

	var postQuery = {
		id: parseInt(req.body.id)
	}

	database.read(db, req.body.type, postQuery, function findPost(posts){
		if (posts.length == 1){

			var otherDefinitionsQuery = {			// are there other definitions for this term?
				term: posts[0].term 				// if not, we need to delete the term
			}

			var isModerator = false;
			if(req.session.user.admin == "true" || req.session.user.moderator == "true" || req.session.user.admin == true || req.session.user.moderator == true){
				isModerator = true;
			}

			if(posts[0].author == req.session.user.username || isModerator){

				database.remove(db, req.body.type, postQuery, function deletePost(post){
					callback({status: "success", message: "Successfully removed post"})
				})

				// now, if it's the last definition for this term...

				if(req.body.type == "definitions"){		// no need to do this for comments
					database.read(db, "definitions", otherDefinitionsQuery, function checkForOtherDefinitions(definitionsForThisTerm){

						console.log("definitionsForThisTerm");
						console.log(definitionsForThisTerm);

						if(definitionsForThisTerm.length == 1){
							// if this is the last definition, we need to delete the term and flip search.exists to false
							// we also need to flip requests back on
							var termQuery = {name: definitionsForThisTerm[0].term}
							database.remove(db, "terms", termQuery, function removeTerm(term){

								var requestUpdateQuery = { term: definitionsForThisTerm[0].term }

								var requestUpdate = {
									$set: { termExists: false }
								}

								database.update(db, "requests", otherDefinitionsQuery, requestUpdate, function updateRequests(response){
									database.updateMany(db, "searches", otherDefinitionsQuery, requestUpdate, function updateSearches(response){
										console.log("searches udpated");
									})

								});

							})
						}
					});
				}

			} else {
				callback({status: "fail", message: "You are not the author of this post"})
			}
		} else {
			callback({status: "fail", message: "This post does not exist"})
		}
	})
}

function getExistingDefinition(db, req, callback){

	var postQuery = {
		id: parseInt(req.body.id)
	}

	database.read(db, "definitions", postQuery, function findPost(posts){
		if (posts.length == 1){

			var isModerator = false;
			if(req.session.user.admin == "true" || req.session.user.moderator == "true" || req.session.user.admin == true || req.session.user.moderator == true){
				isModerator = true;
			}

			if(posts[0].author == req.session.user.username || isModerator){

				callback({status: "success", post: posts[0]});

			} else {
				callback({status: "fail", message: "You are not the author of this post"})
			}
		} else {
			callback({status: "fail", message: "This post does not exist"})
		}
	})
}

function updateExistingDefinition(db, req, callback){

	var postQuery = {
		id: parseInt(req.body.id)
	}

	database.read(db, "definitions", postQuery, function findPost(posts){
		if (posts.length == 1){

			var isModerator = false;
			if(req.session.user.admin == "true" || req.session.user.moderator == "true" || req.session.user.admin == true || req.session.user.moderator == true){
				isModerator = true;
			}

			if(posts[0].author == req.session.user.username || isModerator){

				callback({status: "success", post: posts[0]});

			} else {
				callback({status: "fail", message: "You are not the author of this post"})
			}
		} else {
			callback({status: "fail", message: "This post does not exist"})
		}
	})
}





function passwordResetRequest(db, req, callback){
	
	if(req.body.email.indexOf("@") != -1 && req.body.email.indexOf(".") != -1){
		var userQuery = {
			email: req.body.email
		}

		database.read(db, "users", userQuery, function getUsers(users){

			if(users.length == 1){

				console.log("Yep, " + users[0].username + " is a valid user");

				var userIP = req.headers["X-Forwarded-For"] || req.headers["x-forwarded-for"] || req.client.remoteAddress;

				var dateNow = Date.now()
				var dateExpires = dateNow + 1000 * 60 * 60 * 24;

				var passwordResetRequest = {
					id: generateHash(16),
					date: dateNow,
					expires: dateExpires,			// tomorrow
					completed: false,
					username: users[0].username,
					ip: userIP											// later, it'd be cool to check if the password reset is coming from somewhere sketchy
				}

				database.create(db, "passwordResets", passwordResetRequest, function confirmRequest(request){

 
					var emailBody = "<p>Hey " +  users[0].username + "!<br><br>Here is the password reset link you requested: <br><br>www.hackterms.com/password-reset/" + passwordResetRequest.id + "<br><br>If you did not request this password request, please ignore this email.<br><br>Thanks!<br>-Max from Hackterms";


					var mailOptions = {
					    from: 'Hackterms <hello@hackterms.com>',
					    to:  users[0].email, 
					    subject: 'Reset Your Password', 
					    text: "Here is the password reset link you requested: www.hackterms.com/password-reset/" + passwordResetRequest.id,
					    html: emailBody
					};

					transporter.sendMail(mailOptions, function(error, info){
					    if(error){
					        console.log(error);
					    }else{
					        console.log('Message sent: ' + info.response);
					        callback({status: "success", message: "If we have your email on file, you will receive an instructions to reset your password shortly!"});
					    };
					});

					
				});

			} else {
				console.log("Nope, that's not a valid email");
				callback({status: "success", message: "If we have your email on file, you will receive an instructions to reset your password shortly!"})
			}
		});

	} else {
		callback({status: "fail", message: "This is not a valid email"})
	}
}

function checkPasswordReset(db, req, callback){
	
	if(req.params.id.trim().length){
		
		var resetQuery = {
			id: req.params.id.trim()
		}

		database.read(db, "passwordResets", resetQuery, function checkReset(resets){

			if(resets.length == 1){

				if(Date.now() < resets[0].expires && !resets[0].completed){
					callback({status: "success"});
				} else {
					callback({status: "fail"})
				}
			
			} else {
				callback({status: "fail"})
			}
		});

	} else {
		callback({status: "fail"})
	}
}

function passwordResetAction(db, req, callback){
	
	if(req.body.password === req.body.passwordConfirmation){
		
		var resetQuery = {
			id: req.body.token,
			completed: false
		}

		database.read(db, "passwordResets", resetQuery, function checkReset(resets){

			if(resets.length == 1){
				if(Date.now() < resets[0].expires && !resets[0].completed){
					if(commonPasswords.indexOf(req.body.password.trim()) == -1){
						
						bcrypt.genSalt(10, function(err, salt) {
						    bcrypt.hash(req.body.password, salt, function(err, hash) {
						   		
						   		var userQuery = {
						   			username: resets[0].username,
						        }

						        var userUpdateQuery = {
						        	$set: {
						        		password: hash
						        	}
						        }

						        var resetUpdate = {
						        	$set: {
						        		completed: true
						        	}
						        }

						        /*
									1. set new user password hash
									2. set password reset to completed
						        */

						        database.update(db, "users", userQuery, userUpdateQuery, function confirmPasswordChange(updatedUser){
						        	database.update(db, "passwordResets", resetQuery, resetUpdate, function updateResetRequest(updatedRequest){
						        		callback({status: "success"})
						        	})
						        })
						    })
						}) 

					} else {
						callback({status: "fail", message: "Do you want to get hacked? Because that's how you get hacked.", errorType: "password"});
					}

				} else {
					callback({status: "fail", message: "This password reset has expired. Please request a new password request."})
				}
			
			} else {
				callback({status: "fail"})
			}
		});

	} else {
		callback({status: "fail", message: "Your password confiamtion does not match"})
	}
}

function selectUsername(db, req, callback){

	console.log("dbops - selecting username");

	var usernameQuery = { username: req.body.username.trim().toLowerCase() }


	if(validateCharset(req.body.username.trim())){

		database.read(db, "users", usernameQuery, function checkForUsers(users){
			if(users.length == 0){
				console.log("This username is available!");

				if(req.session.user && typeof(req.session.user.email) != "undefined"){
					var thisUserQuery = {
						email: req.session.user.email
					}

					var usernameUpdate = {
						$set: {
							username: usernameQuery.username
						}
					}

					usernameUpdate.$set["data.username"] = usernameQuery.username;

					database.update(db, "users", thisUserQuery, usernameUpdate, function updateUsername(user){
						req.session.user.username = usernameQuery.username;
						callback({status: "success"});
					})
				} else {
					callback({status: "fail", message: "Something went wrong - please refresh the page or log out and back in"});
				}

			} else if (users.length == 1){
				callback({status: "fail", message: "This username is not available"})
			} else {
				callback({status: "fail", message: "Something went wrong"})
			}

		})
	} else {
		callback({status: "fail", message: "Please only use letters, numbers, or: _ - ."})
	}

}


function getFAQ(db, req, callback){	
	database.read(db, "faq", {}, function getUpdatedFAQ(thisFAQ){
		callback({faq: thisFAQ})
	})
}


function fillInTerms(db, req, callback){

	var definitionQuery = {
		removed: false,
		rejected: false,
		approved: true
	}

	database.read(db, "definitions", definitionQuery, function fetchAllDefinitions(definitions){
		console.log("Got " + definitions.length + " definitions");

		for(var i = 0; i < definitions.length; i++){
			var definition = definitions[i];
			createTermFromDefinition(db, req, i, definition);
		}
	})
}


function createTermFromDefinition(db, req, i, definition){


	setTimeout(function(i){
		var termLink = cleanUrl(definition.term);

		var termSearchQuery = { 
			name: definition.term,
		}

		var sanitizedTerm = sanitizeHtml(definition.term, {
		    allowedTags: [], allowedAttributes: []
		});


		var newTermQuery = { 
			name: sanitizedTerm,
			link: termLink,
			searched: 0,
			date: new Date()
		}

		database.read(db, "terms", termSearchQuery, function checkForExistingTerm(existingTerms){

			if(existingTerms.length == 0){
				console.log("creating new definition for the term '" + newTermQuery.name + "'");

				database.create(db, "terms", newTermQuery, function createdTerm(newTerm){
					console.log();
				});
			} else {
				console.log(definition.term + ": DEFINITION ALREADY EXISTS");

			}

		})
	}, 50*i);

}


function emailAboutNewDefinition(db, thisTerm){


	// update definition: 

	var requestQuery = {
		term: thisTerm
	}

	database.read(db, "requests", requestQuery, function getRequests(requests){

		if(requests.length > 0){

			var newWeight = Math.floor(requests[0].weight/2)

			var requestUpdateQuery = {
				$set: {
					weight: newWeight
				}
			}

			database.update(db, "requests", requestQuery, requestUpdateQuery, function updatedWeight(updatedRequest){
				console.log("The new weight is " + updatedRequest.weight);
			})


		} else {
			console.log("no requests for the term " + thisTerm + " (which is weird)");
		}


	})

	//console.log("EMAIL ABOUT NEW DEFINITION");

	var emailRequestQuery = {
		term: thisTerm
	}

	database.read(db, "definitionRequestEmails", emailRequestQuery, function getPendingEmails(emails){

		if(emails.length > 0){

			console.log("Got " + emails.length + " emails");

			for(var i = 0; i < emails.length; i++){
				var email = emails[i];
				sendRequestDefinitionEmail(db, email, i);
			}
		}

	});

}

function sendRequestDefinitionEmail(db, email, i){
	setTimeout(function(i){

		console.log("Sending email to " + email.email);
		
		var emailBody = "<p>Hey " +  email.username + ",<br><br>Just wanted to let you know that one of our contributors added a new definition for <strong>" + email.term + '</strong>. <a href = "https://www.hackterms.com/' + email.term + '">You can see it here.</a> If this explanation still doesn not make sense, you can always request another! <br></p>-Hactkerms Team';

		var emailSubject = "A definition for [" + email.term + "] has been added"

		var mailOptions = {
		    from: 'Hackterms <hello@hackterms.com>',
		    to:  email.email, 
		    subject: emailSubject, 
		    text: "Hey " +  email.username + ",\n\nJust wanted to let you know that one of our contributors added a new definition for[ " + email.term + "]: https://www.hackterms.com/" + email.term + ". You asked us to notify you when this happens - hope you check it out. If this explanation still doesn not make sense, you can always request another!\n\n-Hactkerms Team",
		    html: emailBody
		};

		transporter.sendMail(mailOptions, function(error, info){
		    if(error){
		        console.log(error);
		    } else {
		        console.log('Message sent: ' + info.response);
		        var thisEmailQuery = {
		        	username: email.username,
		        	email: email.email,
		        	term: email.term
		        }

		        database.remove(db, "definitionRequestEmails", thisEmailQuery, function(result){
		        	console.log("Query for the term " + email.term + " has been removed for user " + email.user);
		        })
		    };
		});



	}, 50*i);
}


function createNotification(db, req, user, message, thisTerm, thisStatus, thisType, callback){
	var newNotification = {
		to: user,
		from: "admin",
		date: new Date(),
		body: message,
		type: thisType,
		term: thisTerm,
		status: thisStatus
	}

	var newNotificationsUpdate = {
		$set: {
			"data.newNotifications": true
		}
	}

	var userQuery = {
		username: user
	}

	
	database.create(db, "notifications", newNotification, function createNotification(newNotification){
		database.update(db, "users", userQuery, newNotificationsUpdate, function addNewNotification(updatedUser){

			console.log("newNotification");
			console.log(newNotification[0]);


			console.log("Notification created for " + user);
			callback();
		});
	})
}




/* NON-DB FUNCTIONS */

function generateHash(hashLength){
	var chars = "abcdefghijklmnopqrstuvwxyz1234567890"
    var hash = "";

    for (var i = 0; i < hashLength ; i++){
    	hash += chars[Math.floor(Math.random()*chars.length)]
    }

    return hash;
}

function cleanUrl(text){

	text = text.split("%").join("%25");
	text = text.split(" ").join("%20");
	text = text.split("$").join("%24");
	text = text.split("&").join("%26");
	text = text.split("`").join("%60");
	text = text.split(":").join("%3A");
	text = text.split("<").join("%3C");
	text = text.split(">").join("%3E");
	text = text.split("[").join("%5B");
	text = text.split("]").join("%5D");
	text = text.split("+").join("%2B");
	text = text.split("#").join("%23");
	text = text.split("@").join("%40");
	text = text.split("/").join("%2F");

	return text;

}

function validateCharset(string){

	var stringIsValid = true;
	var validChars = "ABCDEFGHIJKLMONPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890_-.";

	for(var i = 0; i < string.length; i++){
		console.log(string[i] + ": " + validChars.indexOf(string[i]));
		if(validChars.indexOf(string[i]) == -1){ stringIsValid = false }
	}

	return stringIsValid;
}

function sanitizeInput(string){
	string = string.replace("<script>", "").replace("</script>", "").replace("<img>", "").replace("<script", "").replace("<img", "");
	return(string);
}


function validateInput(string){

    var isStringValid = true;
    var extraBadWords = ["<script", "<img", "fuck", "cock", "cunt", "nigger", "pussy", "bitch"];
    var forbiddenWords = ["<script>", "</script>", "<img>", "anus", "ass", "asswipe", "ballsack", "bitch", "blowjob", "blow job", "clit", "clitoris", "cock", "coon", "cunt", "cum", "dick", "dildo", "dyke", "fag", "felching", "fuck", "fucking", "fucker", "fucktard", "fuckface", "fudgepacker", "fudge packer", "flange", "jizz", "nigger", "nigga", "penis", "piss", "prick", "pussy", "queer", "tits", "smegma", "spunk", "boobies", "tosser", "turd", "twat", "vagina", "wank", "whore"];
    var linkWords = ["http://", "https://", "www."];


    // 1. split the string into an array of words

    var cleanString = string.replace(/[.,\/#!$%\^&\*;\+:{}=\-_`~()]/g,"");          // use regex to remove all punctuation
    var wordArray = cleanString.split(" ");

    for(var i = (wordArray.length - 1); i >= 0; i--) {              // we need to go backwards because splitting changes the length of the string
        if(wordArray[i].trim().length == 0) {
            wordArray.splice(i, 1);
        }
    }
    

    // 2. check every word against a list of offensive terms; see if it's a link other than example.com

    console.log("string");
    console.log(string);

    for(var j = 0; j < wordArray.length; j++){
        if(forbiddenWords.indexOf(wordArray[j]) != -1){
            isStringValid = false;
            console.log(wordArray[j] + " is not allowed");
        } else {

            for(var h = 0; h < extraBadWords.length; h++){
                if(wordArray[j].indexOf(extraBadWords[h]) != -1){
                    isStringValid = false;
                    console.log(wordArray[j] + " is not allowed");
                } 
            }

            for(var k = 0; k < linkWords.length; k++){
                console.log(wordArray[j]);
                if(string.indexOf(linkWords[k]) != -1 && string.indexOf("example.com") == -1){
                    isStringValid = false;
                    console.log(wordArray[j] + " looks like a link");
                } 
            }
        } 
    }

    return isStringValid;
}

function getItemsByDay(items, field, days){

    var itemData = {};
    var now = new Date();
    var oneDay = 24 * 60 *60 * 1000;

    console.log("sorting " + items.length + " total items for the past " + days + " days");

    // 0   1    2    3    4     5 ...

    for(var i = 0; i < days; i++){			// cycle through each day, build start and end dates by midnight

    	var timezoneOffset = now.getTimezoneOffset()/60;			// this gets returned in minutes
    	console.log("Timezone offset: " + timezoneOffset);


        var startDate = new Date(new Date((now.getTime() - oneDay * i)).setHours((timezoneOffset), 0,0,0))        // subtract i day(s) from today
        var endDate = new Date(startDate.getTime() + oneDay)            // 24 hours later
       	console.log(startDate + ", " + endDate);


        itemData[startDate] = 0;

        for(var j = 0; j < items.length; j++ ){
        	//console.log("items length " + items.length);

        	var itemDate =  new Date(items[j][field]);

        	if(itemDate >= startDate && itemDate < endDate){
        		itemData[startDate]++;
        	} 
        }
    }

    console.log("items left: " + items.length);

	return itemData;

}




/* MODULE EXPORES */
module.exports.search = search;
module.exports.logSearch = logSearch;
module.exports.getDefinitions = getDefinitions;
module.exports.addDefinition = addDefinition;
module.exports.getComments = getComments;
module.exports.addComment = addComment;
module.exports.vote = vote;
module.exports.generateHash = generateHash;
module.exports.getExistingDefinition = getExistingDefinition;
module.exports.deletePost = deletePost;

module.exports.logVisit = logVisit;

module.exports.signup = signup;
module.exports.login = login;
module.exports.googleLogin = googleLogin;
module.exports.githubLogin = githubLogin;
module.exports.getUpdatedUser = getUpdatedUser;

module.exports.getAdminData = getAdminData;
module.exports.getMetrics = getMetrics;
module.exports.getAnalytics = getAnalytics;
module.exports.adminVote = adminVote;
module.exports.addReport = addReport;

module.exports.getTopTerms = getTopTerms;
module.exports.getRandomTerm = getRandomTerm;

module.exports.getUserRoles = getUserRoles;
module.exports.updateUserRoles = updateUserRoles;

module.exports.getUserData = getUserData;
module.exports.getFAQ = getFAQ;
module.exports.getAllTerms = getAllTerms;

module.exports.clearNotifications = clearNotifications;
module.exports.passwordResetRequest = passwordResetRequest;
module.exports.checkPasswordReset = checkPasswordReset;
module.exports.passwordResetAction = passwordResetAction;
module.exports.selectUsername = selectUsername;

module.exports.requestDefinition = requestDefinition;

module.exports.fillInTerms = fillInTerms;
module.exports.getEmptyTerms = getEmptyTerms;