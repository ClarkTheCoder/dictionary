const database = require("./database");
const bcrypt = require('bcrypt');                         // encrypt passwords
const nodemailer = require('nodemailer');				  // send email
var request = require('request');                         // send HTTP requests

var transporter = nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.ZOHO_USERNAME,
        pass: process.env.ZOHO_PASSWORD 
    }
});



const commonPasswords = ["123456", "password", "password1", "password123", "password321", "123456", "654321", "12345678", "87654321", "football", "qwerty", "1234567890", "1234567", "princess", "aaaaaa", "111111"]


function search(db, req, callback){

	// ??

	req.body.term = req.body.term.replace(String.fromCharCode(40),String.fromCharCode(92, 40));
	req.body.term = req.body.term.replace(String.fromCharCode(41),String.fromCharCode(92, 41));
	req.body.term = req.body.term.replace(String.fromCharCode(91),String.fromCharCode(92, 91));
	req.body.term = req.body.term.replace(String.fromCharCode(93),String.fromCharCode(92, 93));


	searchQuery = {
		name: {
			$regex: RegExp(req.body.term),
			$options: 'i'
		}
	}


	// var userIP = req.headers["X-Forwarded-For"] || req.headers["x-forwarded-for"] || req.client.remoteAddress;
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

				newSearchRecord.termExists = true;

				var termUpdate = { 
					$inc: {
						"searched": 1
					} 
				}

				database.update(db, "terms", termQuery, termUpdate, function confirmUpdate(result){
					console.log("Search recorded");
				})
			} else {
				if(typeof(req.body.term) != "undefined" && req.body.term.length){
					logRequestedSearch(db, req.body.term);
				} else { 
					console.log( "There is no term to search"); 
				} 
			}

			/* THIS IS NOT GOOD - should be counting, not reading. Weird error with counting here. */
			// 2. create search for this
			database.create(db, "searches", newSearchRecord, function logSearch(loggedSearch){
				callback();
			});


		})


	} else {
		callback();
	}
}

function logRequestedSearch(db, term){

	var thisTerm = term;

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
			$regex: new RegExp(regexSearch)
		}
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
					"searched": 1
				} 
			}

			database.update(db, "requests", requestQuery, requestUpdate, function confirmUpdate(result){
				console.log("Request recorded");
			})
		} else {
			// if a request doesn't exist, create it

			var newRequest = {
				term: term.toLowerCase(),
				searched: 1,
				termExists: false
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

			if(validateInput(req.body.definition)){

				database.read(db, "definitions", userSubmissionsQuery, function fetchUser(approvedDefinitions){


					var relatedTerms = [];

					// let's make sure the related terms exist and are kosher
					if(req.body.related){
						req.body.related.forEach(function(term){
							if(term.trim().length && validateInput(term)){
								relatedTerms.push(term.toLowerCase())
							}
						})
					}

					console.log("This user has submitted " + approvedDefinitions.length + " definitions");

					var newDefinitionQuery = {
						id: Math.floor(Date.now()/Math.random()),							// hopefully this should give us a random ID
						term: req.body.term.trim().toLowerCase(),
						author: req.session.user.username,
						upvotes: 1,
						downvotes: 0, 
						reportCount: 0,
						removed: false,
						approved: false,
						rejected: false,
						lastEdit: new Date(),
						created: new Date(),
						body: req.body.definition,
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
						name: req.body.term,
						link: termLink,
						searched: 0,
						date: new Date()
					}

					database.read(db, "terms", termSearchQuery, function checkForExistingTerm(existingTerms){

						if(existingTerms.length == 0){
							console.log("creating new definition for the term '" + newTermQuery.name + "'");
							database.create(db, "terms", newTermQuery, function createdTerm(newTerm){
								database.create(db, "definitions", newDefinitionQuery, function createdDefinition(newDefinition){
									console.log(newDefinition.ops[0]);
									database.create(db, "votes", newVote, function createdVote(newVote){

										/* remove requests for this term */

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
					message: "No profanity or links, please"
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
		if(req.body.commentBody){

			if(validateInput(req.body.commentBody)){
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

						if(existingComment.body.trim() == req.body.commentBody.trim()){
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
								newCommentQuery = {
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
									body: req.body.commentBody
								}

								database.create(db, "comments", newCommentQuery, function createComment(newComment){
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
				callback({ status: "fail", message: "No profanity or links, please" });
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

		var voteChange

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

		var userQuery = {
			username: req.body.author
		}

		database.update(db, "definitions", definitionQuery, definitionUpdateQuery, function updateDefinition(response){
			database.create(db, "notifications", newNotification, function createNotification(newNotification){
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

		var thisDecision = "report dismissed"
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
							to: updatedReport.author,
							from: "admin",
							date: new Date(),
							body: "Your comment has been removed",
							type: thisType,
							status: "removed"
						}

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
	console.log(req.body);

	if(req.body.username.trim().length && req.body.password.trim().length){    	// let's make sure the username and password aren't empty
		if(req.body.username.trim().length && req.body.password.trim().length > 5){    
			if(req.body.username.replace(/\s/g, '').length == req.body.username.length){
				if(req.body.email.trim().length && req.body.email.indexOf("@") != -1 && req.body.email.indexOf(".") != -1){

					if(commonPasswords.indexOf(req.body.password.trim()) == -1){
						bcrypt.genSalt(10, function(err, salt) {
						    bcrypt.hash(req.body.password, salt, function(err, hash) {
						   		var newUser = {
						   			createdOn: new Date(),
						   			email: req.body.email.trim().toLowerCase(),
						   			username: req.body.username.trim().toLowerCase(),
						            password: hash,
						            lastLoggedOn: new Date(),
						            suspended: false,
						            admin: false,
						            moderator: false,
						   			data: {
						   				username: req.body.username.toLowerCase(),
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

								var userQuery = {
									username: newUser.username,
								}

								database.read(db, "users", userQuery, function(existingUsers){
									if(existingUsers.length == 0){																		
										database.create(db, "users", newUser, function(newlyCreatedUser){
											callback({status: "success", message: "Account created. Go ahead and log in!", user: newlyCreatedUser[0]})
										});
									} else {	
										callback({status: "fail", message: "That username is not available", errorType: "username"})
									}
								})     
						    });
						});
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
				bcrypt.compare(req.body.password, existingUsers[0].password, function(err, res) {
					if(res){													// if the two password hashes match...
						if(existingUsers[0].suspended == "false" || existingUsers[0].suspended == false){

							var loginDateUpdate = {
								$set: {
									lastLoggedOn: new Date()
								}
							}

							database.update(db, "users", userQuery, loginDateUpdate, function updateLastLogin(lastLogin){

								console.log("Logged in successfully.")
				                req.session.user = existingUsers[0].data;
				                req.session.user.admin = existingUsers[0].admin;
				                req.session.user.moderator = existingUsers[0].moderator;

				                var day = 60000*60*24;

				                if(req.body.rememberMe == "true" || req.body.rememberMe == true){
				                	req.session.cookie.expires = new Date(Date.now() + (14*day));
				                	req.session.cookie.maxAge = (14*day);                           // this is what makes the cookie expire
				                }


				                callback({status: "success", message: "Logged in"});

							})
						} else {
							req.session.user = null;
							callback({status: "fail", message: "Your account has been suspended", errorType: "username"})
						}
					} else {
						req.session.user = null;
						callback({status: "fail", message: "Login or password are incorrect", errorType: "username"})
					}
				});										
			} else {
				req.session.user = null;
				callback({status: "fail", message: "Login or password are incorrect", errorType: "username"})
			}
		});

	} else {
		callback({status: "fail", message: "Username is blank", errorType: "username"})
	}
}

function getTopTerms(db, req, callback){

	var requestQuery = { termExists: false }
	var orderQuery = { searched: -1 }

	database.sortRead(db, "terms", {}, orderQuery, function getSearches(allSearches){
		var topSearches = allSearches.splice(0, 10);

		console.log("topSearches");
		console.log(topSearches);

		database.sortRead(db, "requests", requestQuery, orderQuery, function getSearches(allRequests){
			var topRequests = allRequests.splice(0, 10);

			console.log("topRequests");
			console.log(topRequests);


			var response = {
				topRequests: topRequests,
				topSearches: topSearches
			}

			//console.log(response);
			callback(response);
		})
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

    var ignoredUrls = ["/get-definitions", "/search", "/metrics", "/updated-user-data", "/log-search", "/login", "/robots.txt", "/password-reset"]
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
			console.log("Something went wrong with fetchign the session");
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
		database.count(db, "visits", visitsQuery, function getVisits(visitList){
			database.sortRead(db, "definitions", approvedDefinitionQuery, dateSort, function getApprovedDefinitionCount(approvedDefs){
				database.read(db, "definitions", unapprovedDefinitionQuery, function getUnapprovedDefinitionCount(unapprovedDefs){
					database.sortRead(db, "searches", searchQuery, searchSort, function getSearches(allSearches){
						database.count(db, "terms", termCountQuery, function getTermCount(thisTermCount){
							var thisUserCount = userList.length;

							callback({
								visitCount: visitList,
								userCount: thisUserCount,
								searches: allSearches,
								users: userList,
								approvedDefinitions: approvedDefs,
								unapprovedDefinitions: unapprovedDefs,
								termCount: thisTermCount
							})
						})
					})
				})
			})

		})
	})



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

			if(posts[0].author == req.session.user.username || req.session.admin || req.session.moderator){

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

			if(posts[0].author == req.session.user.username){

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

			if(posts[0].author == req.session.user.username){

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

 
					var emailBody = "<p>Hey " +  users[0].username + "!<br><br>Here is the password reset link you requested: <br><br>www.hackterms.com/password-reset/" + passwordResetRequest.id + "<br><br>If you did not request this password request, please ignore this email.<br><br>Thanks!<br>~your Hackterms friends";


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

function getFAQ(db, req, callback){	
	database.read(db, "faq", {}, function getUpdatedFAQ(thisFAQ){
		callback({faq: thisFAQ})
	})
}

function getAllTerms(db, req, callback){	

	// not using database.js for this
	db.collection("terms").find({}).sort({name: 1}).toArray(function getTerms(err, result) {
        if (err){
            console.log("MAYDAY! MAYDAY! Crashing.");
            console.log(err);
        }

        callback({terms: result});
    });
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


function validateInput(string){

    var isStringValid = true;
    var extraBadWords = ["fuck", "cock", "cunt", "nigger", "pussy", "bitch"];
    var forbiddenWords = ["anus", "ass", "asswipe", "ballsack", "bitch", "blowjob", "blow job", "clit", "clitoris", "cock", "coon", "cunt", "cum", "dick", "dildo", "dyke", "fag", "felching", "fuck", "fucking", "fucker", "fucktard", "fuckface", "fudgepacker", "fudge packer", "flange", "jizz", "nigger", "nigga", "penis", "piss", "prick", "pussy", "queer", "tits", "smegma", "spunk", "boobies", "tosser", "turd", "twat", "vagina", "wank", "whore"];
    var linkWords = ["http://", "https://", "www."];


    // 1. split the string into an array of words

    var cleanString = string.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");          // use regex to remove all punctuation
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
module.exports.getUpdatedUser = getUpdatedUser;

module.exports.getAdminData = getAdminData;
module.exports.getMetrics = getMetrics;
module.exports.adminVote = adminVote;
module.exports.addReport = addReport;

module.exports.getTopTerms = getTopTerms;

module.exports.getUserRoles = getUserRoles;
module.exports.updateUserRoles = updateUserRoles;

module.exports.getUserData = getUserData;
module.exports.getFAQ = getFAQ;
module.exports.getAllTerms = getAllTerms;

module.exports.clearNotifications = clearNotifications;
module.exports.passwordResetRequest = passwordResetRequest;
module.exports.checkPasswordReset = checkPasswordReset;
module.exports.passwordResetAction = passwordResetAction;

