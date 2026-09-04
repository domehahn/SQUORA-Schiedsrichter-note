(function () {
  "use strict";
  var path = window.location.pathname;
  var marker = "/live/";
  var cut = path.lastIndexOf(marker);
  var token = decodeURIComponent(path.slice(cut + marker.length).replace(/\/$/, ""));
  var base = path.slice(0, cut);
  var el = {
    home: document.getElementById("home-name"),
    away: document.getElementById("away-name"),
    score: document.getElementById("score"),
    phase: document.getElementById("phase"),
    events: document.getElementById("events"),
    error: document.getElementById("error"),
    updated: document.getElementById("updated"),
  };
  var PHASE_LABELS = {
    setup: "Vor Anpfiff", firstHalf: "1. Halbzeit", halfTime: "Halbzeit",
    secondHalf: "2. Halbzeit", extraFirst: "1. HZ Verlängerung", extraBreak: "Pause Verlängerung",
    extraSecond: "2. HZ Verlängerung", shootout: "Elfmeterschießen", finished: "Beendet", abandoned: "Abgebrochen",
  };

  function render(data) {
    el.error.hidden = true;
    el.home.textContent = data.homeTeam;
    el.away.textContent = data.awayTeam;
    el.score.textContent = data.homeScore + " : " + data.awayScore;
    el.phase.textContent = PHASE_LABELS[data.phase] || data.phase;
    el.events.innerHTML = "";
    var events = data.events || [];
    for (var i = events.length - 1; i >= 0; i -= 1) {
      var event = events[i];
      var li = document.createElement("li");
      var side = event.team === "home" ? data.homeTeam : event.team === "away" ? data.awayTeam : "";
      var text = event.minute + "' " + event.label;
      if (event.detail) text += " · " + event.detail;
      if (side) text += " · " + side;
      li.textContent = text;
      el.events.appendChild(li);
    }
    if (events.length === 0) {
      var empty = document.createElement("li");
      empty.className = "muted";
      empty.textContent = "Noch keine Ereignisse.";
      el.events.appendChild(empty);
    }
    var now = new Date();
    el.updated.textContent = "Aktualisiert " + now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function poll() {
    fetch(base + "/api/v1/live/" + encodeURIComponent(token), { headers: { Accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) throw new Error("not-found");
        return response.json();
      })
      .then(render)
      .catch(function () {
        el.error.hidden = false;
      });
  }

  poll();
  setInterval(poll, 5000);
})();
