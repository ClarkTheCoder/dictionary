function frequencyCount(array){
    var hashTable = {}

    for(var i = 0; i<array.length; i++){
        var item = array[i],
            itemCount = (hashTable[item] ? hashTable[item] : 0);

        if (!item.length){ continue; }
        hashTable[item] = itemCount + 1;

    }

    console.log(hashTable);

    return hashTable;
}

function sortKeysByFrequency(array) {
    var sortedObject = frequencyCount(array),
        newTermsArray = Object.keys(sortedObject);
        
        var sortedArray = newTermsArray.sort(function(item) { return sortedObject[item] });
        console.log(sortedArray);

    return  sortedArray;
}
                                                 // remove when I make sense of the code above
function sortRelatedTerms(terms){                // messy solution to sorting an array in order of frequency

    relatedTerms = {};

    for(var i = 0; i<terms.length; i++){
        var term = terms[i];

        if(typeof(relatedTerms[term]) == "undefined"){
            relatedTerms[term] = 1;
        } else {
            relatedTerms[term]++;
        }
    }


    var termsInOrder = [];
    var mostFrequentTermCount;
    var currentTopKey = "";
    var objectLength = Object.keys(relatedTerms).length;

    for(var j = 0; j < objectLength; j++){         // cycle through as many times as there are keys
        mostFrequentTermCount = 0;
        for(var key in relatedTerms){                                   // for each key...

            if (relatedTerms[key] >= mostFrequentTermCount) {
                mostFrequentTermCount = relatedTerms[key];
                currentTopKey = key;
            }
        }

        delete relatedTerms[currentTopKey];                   // remove that key from the object
        termsInOrder.push(currentTopKey)

        if(j == objectLength - 1){
            for(var k = 0; k < termsInOrder.length; k++){
                $("#related-terms-section").append("<a class= 'related-term'>" + termsInOrder[k] + "</a>");
                $(".related-term").last().attr("href", cleanUrl(termsInOrder[k]));
            }
        }

    }   

}




function insertTermLinks(terms, thisTerm){
    if($(".definition-body").length > 0){  
        // $(".definition-body").each(function(){                         // iterate through each definition on the page
            
        for(var i = 0; i < $(".definition-body").length; i++){

            var thisDefinitionBody = $(".definition-body").eq(i);

          //var text = $(this).html();
            var text = thisDefinitionBody.html();

            var copy = text;
            var htmlCopy = text;
            var ignoredTerms = ["if", "when", "else", "then", "all", "metrics", "faq"];
            
            terms.forEach(function(term){      // iterate through each term
                if(term.length >= 2 && term.toLowerCase() != thisTerm.toLowerCase() && ignoredTerms.indexOf(term.toLowerCase()) == -1){          // if the term isn't blank and isn't the same as the term card
                    
                    var matchIndex = copy.toLowerCase().indexOf(term.toLowerCase());        // where is the term in the copy?  
                    
                    if(matchIndex != -1 && term != thisTerm){

                        // let's check if this is a whole word
                        var startIndex = matchIndex;
                        var endIndex = matchIndex + term.length - 1;

                        var originalTerm = copy.substring(startIndex, endIndex + 1);
                        var alphabet = "abcdefghijklmonpqrstuvwxyz1234567890"; 

                        // console.log("Found a match for [" + term.toLowerCase() + "]");                        
                        // console.log("The letter at match index " + matchIndex + " is: " + htmlCopy[matchIndex]);

                        // let's ensure this is a whole word
                        if( (startIndex == 0 || alphabet.indexOf(htmlCopy[startIndex-1].toLowerCase()) == -1 ) && (endIndex == (htmlCopy.length-1) || alphabet.indexOf(htmlCopy[endIndex+1].toLowerCase()) == -1)  ){

                            //only replace word if the first letters match
                            if(htmlCopy[matchIndex].toLowerCase() == term[0].toLowerCase()){

                                copy = copy.slice(0, matchIndex) + Array(term.length + 33).join("ಠ") + copy.slice( (matchIndex + term.length) , copy.length );    // 32 is the length of <a href = ''></a>
                                htmlCopy = htmlCopy.slice(0, matchIndex) + "<a class=\'linked-term bold\'>" + originalTerm + "</a>" + htmlCopy.slice( (matchIndex + term.length) , htmlCopy.length)
                            
                               /* console.log("New HTML: ");
                                console.log(htmlCopy);

                                console.log("New copy: ");
                                console.log(copy);*/


                                thisDefinitionBody.html(htmlCopy);

                                thisDefinitionBody.find("a").each(function(){
                                    $(this).attr("href", cleanUrl($(this).text())); 
                                });


                            }

                        }/* else {
                            //console.log(term + " is not a whole word because the preceding letter is [" + copy[startIndex-1].toLowerCase() + "] and the following letter is [" + copy[endIndex+1].toLowerCase() + "]");
                        }*/
                    }
                } 

            })
  
        }
    }
}


function findRegexTermInArray(array, term){

    //var regexTerm = new RegExp(term.toLowerCase().replace(/\W/g, ''), 'i');      // clear all non-alphanumeric characters
      var regexTerm = new RegExp(term.toLowerCase().replace(/\s.\(\)\-/g, '').replace(/[-[\]{}*+?,\\^$|#\s]/g, '\\$&'), 'i');      // remove all spaces, parantheses, and periods

    // .replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')             // escape weird chars


    // console.log(regexTerm);

    var termsFound = array.filter(function(term){
        return term.toLowerCase().replace(/\s.\(\)\-/g, '').replace(/[-[\]{}*+?,\\^$|#\s]/g, '\\$&').match(regexTerm);
    });

    return termsFound;
}


function replaceAt(text, index, replacement) {
    return text.substr(0, index) + replacement + text.substr(index + replacement.length);
}

function replaceWith(text, index, replacement, termLength){
    return text.substr(0, index) + replacement + text.substr(index + termLength, text.length)
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

    
