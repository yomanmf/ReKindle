"use strict";

var NRL_TEAM_NAMES = {
    "Broncos": true, "Raiders": true, "Bulldogs": true, "Sharks": true,
    "Dolphins": true, "Titans": true, "Sea Eagles": true, "Storm": true,
    "Knights": true, "Warriors": true, "Cowboys": true, "Eels": true,
    "Panthers": true, "Rabbitohs": true, "Dragons": true, "Roosters": true,
    "Wests Tigers": true
};

function parseNRLScoreboard(html) {
    var events = [];
    var currentDate = "";
    var tokenRegex = /(?:<header class="Card__Header[^"]*"[^>]*aria-label="([^"]*)"\s*>|<div class="ScoreboardScoreCell[^"]*ScoreboardScoreCell--(pre|post|in)[^"]*"[^>]*>)/g;
    var match;
    while ((match = tokenRegex.exec(html)) !== null) {
        if (match[1]) {
            currentDate = match[1];
        } else if (match[2]) {
            var startIdx = match.index;
            var endIdx = findMatchingClose(html, startIdx);
            if (endIdx > startIdx) {
                var game = parseGameCell(html.substring(startIdx, endIdx), currentDate, match[2], events.length);
                if (game && isNRLMatch(game.competitions[0].competitors)) events.push(game);
            }
        }
    }
    return events;
}

function findMatchingClose(html, startIdx) {
    var depth = 1;
    var i = html.indexOf(">", startIdx) + 1;
    while (i < html.length && depth > 0) {
        var openIdx = html.indexOf("<div", i);
        var closeIdx = html.indexOf("</div>", i);
        if (closeIdx === -1) return -1;
        if (openIdx !== -1 && openIdx < closeIdx) {
            depth += 1;
            i = openIdx + 1;
        } else {
            depth -= 1;
            if (depth === 0) return closeIdx + 6;
            i = closeIdx + 1;
        }
    }
    return -1;
}

function parseGameCell(cellHtml, dateLabel, state, index) {
    var competitors = [];
    var itemRegex = /<li class="ScoreboardScoreCell__Item[^"]*ScoreboardScoreCell__Item--(home|away)[\s\S]*?<div class="ScoreCell__TeamName ScoreCell__TeamName--shortDisplayName[^"]*">([^<]+)<\/div>(?:[\s\S]*?<div class="ScoreCell__Score[^"]*ScoreCell_Score--scoreboard[^"]*">([^<]*)<\/div>)?/g;
    var itemMatch;
    while ((itemMatch = itemRegex.exec(cellHtml)) !== null) {
        var name = itemMatch[2].trim();
        competitors.push({
            homeAway: itemMatch[1],
            score: (itemMatch[3] || "").trim(),
            team: { id: "nrl-" + name.toLowerCase().replace(/\s+/g, "-"), shortDisplayName: name, abbreviation: name, logo: "" }
        });
    }
    if (competitors.length !== 2) return null;
    return {
        id: "nrl-" + index,
        competitions: [{ competitors: competitors }],
        status: { type: { state: state === "post" ? "post" : state === "in" ? "in" : "pre", shortDetail: state === "post" ? "Final" : state === "in" ? "Live" : dateLabel } }
    };
}

function isNRLMatch(competitors) {
    return competitors.every(function (competitor) { return NRL_TEAM_NAMES[competitor.team.shortDisplayName] === true; });
}

module.exports = { parseNRLScoreboard: parseNRLScoreboard };
