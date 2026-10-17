var $ = require("jquery"),
    THREE = require("three"),
    systems = require("./systems.js"),
    rooms = require("../../app/js/rooms.js"),
    msg = require("../../app/js/message.js");

/* The scan wireframe is drawn from the same room rectangles the house widget
   and the room panels use, so a corrected rectangle fixes this too. */
var ROOMS = rooms.ROOMS,
    BOUNDS = rooms.BOUNDS,
    LEVEL1_ELEVATION = rooms.LEVEL1_ELEVATION;

/* The live Home Assistant client, handed over by main.js once it exists.
   MUTHER's commands read and act through this and nothing else. */
var ha = null;

function systemByKey(key){
    for(var i = 0; i < systems.length; i++){
        if(systems[i].key === key){
            return systems[i];
        }
    }
    return null;
}

var webglTest,
    active = false,
    initialized = false,
    currentWidth = 0,
    currentHeight = 0,
    hideFn = function(){},
    LightTable = {},
    lastMessageTime = null,
    numUsers = 1,
    dataStreamOn = false;

/* public function */

LightTable.init = function(_hideFn){

    hideFn = _hideFn;

    $(".lt-header").css("visibility", "hidden");
    $(".content-container").css("visibility", "hidden");


    $("#lt-keyboard").css("opacity", 0);


    webglTest = createHouseScan();

    $("#light-table").css("visibility", "visible");

    currentWidth = $(window).width();
    currentHeight = $(window).height();


    /* set events */

    /* One handler per system folder. The typing flow stays Encom's:
       cd <system>, ls, then run <system>.exe */
    systems.forEach(function(system){
        $("#lt-launch-" + system.key).click(function(){
            $(this).find(".folder-" + system.size).css("background-color", "#fff");
            simulateCommand("|cd " + system.key + "$");
            simulateCommand("ls$");
            simulateCommand("run " + system.key + ".exe$");
            $(document).off();
            $(".folder-container").off();
        });
    });

    $("#lt-keyboard div").mousedown(function(event){
        event.preventDefault();
        keyClick(parseInt($(this).attr("id").split("-")[1]));
    });

    initialized = true;
};

LightTable.show = function(cb){

    $("#light-table").css("opacity", 1);
    // do the intro animations
    showContainer();
    setTimeout(showHeaders, 500);
    showContentBoxes($("#lt-readme"), 0);

    showContentBoxes($("#lt-bandwidth"), 100);
    showContentBoxes($("#lt-globalization"), 200);
    showKeyboard();

    if($("#lt-mobile-readme").width() > 0){
        showContentBoxes($("#lt-mobile-readme"), 0);
    }

    $(document).keydown(function(event){

        if(!event.ctrlKey && (event.which < 112 || event.which > 134) && event.which != 91) { // let them do f1-f12, windows key
            var keycode = event.which;
            event.preventDefault();
            keyClick(keycode);
        }
    });

    if(typeof cb == "function"){
        setTimeout(cb, 500);
    }

    active = true;
};

LightTable.hide = function(cb) {
    // reset everything

    active = false;
    $("#lt-mobile-readme").attr("style","");
    $("#k-32").attr("style","");
    $(".lt-header-animator-right").attr("style","");
    $(".lt-header-animator-left").attr("style","");

    $("#light-table").animate({
        opacity: 0
    }, 500);

    setTimeout(function(){
        hideKeyboard();
        hideContainer();
        hideWebgl();
    }, 500);

    webglTest.reset();

    $(document).off();

    if(typeof cb == "function"){
        cb();
    }
};

LightTable.animate = function(){
    if(active && initialized){
        webglTest.tick();
    }
};

var resizing = false;
LightTable.resize = function(){
    if(!resizing && (currentWidth > 1600 && $(window).width() <= 1600) || (currentWidth <= 1600 && $(window).width() > 1600)){

        currentWidth = $(window).width();
        resizing = true;
        LightTable.hide();
        setTimeout(LightTable.show,1000);

        setTimeout(function(){
            resizing = false;
        }, 3000);
    }
};


LightTable.message = function(message){
    lastMessageTime = Date.now();
};

LightTable.setHomeAssistant = function(client){
    ha = client;
};

/* Called by main.js on every Home Assistant status change. Green when the
   link is up, orange when it is not, per rule 10. */
LightTable.setLink = function(connected){
    $("#datalink-status")
        .text(connected ? "LINK: CONNECTED" : "LINK: OFFLINE")
        .attr("class", connected ? "link-online" : "link-offline");
};

/* private functions */

/* Layout space geometry, immune to the transform on #light-table.
   offsetTop and offsetLeft are border box offsets from the offset parent, and
   computed width and height are content box, which is what jQuery .width()
   and .height() set. */
function box(el){
    var node = el.jquery ? el[0] : el;
    var cs = window.getComputedStyle(node);
    return {
        top: node.offsetTop,
        left: node.offsetLeft,
        width: parseFloat(cs.width) || 0,
        height: parseFloat(cs.height) || 0,
        outerWidth: node.offsetWidth,
        outerHeight: node.offsetHeight
    };
}

function showContainer(){
    var outside = $("#lt-container-outside");
    var inside = $("#lt-container-inside");

    /* Positions are relative to #light-table, which is the scaled box, so the
       wipe blockers are measured and appended inside it too. Measuring against
       the window instead would place them at unscaled viewport coordinates. */
    var outsideBox = box(outside);
    var insideBox = box(inside);

    var outsideOffset = { top: outsideBox.top, left: outsideBox.left };
    var insideOffset = { top: insideBox.top, left: insideBox.left };

    var outsideWidth = outsideBox.width;
    var outsideHeight = outsideBox.height;

    var insideWidth = insideBox.width;
    var insideHeight = insideBox.height;

    var outsideBlockerTopRight = $("<div>");
    var outsideBlockerBottomLeft = $("<div>");
    var insideBlockerTopRight = $("<div>");
    var insideBlockerBottomLeft = $("<div>");

    $('#light-table').append(outsideBlockerTopRight)
    .append(outsideBlockerBottomLeft)
    .append(insideBlockerTopRight)
    .append(insideBlockerBottomLeft);

    outsideBlockerTopRight.css({
        "background-color": "#000",
        // "background-color": "#aa0000",
        // opacity: .5,
        position: "absolute",
        top: outsideOffset.top - 5,
        left: outsideOffset.left - 5,
        width: outsideBox.outerWidth + 10,
        height: outsideBox.outerHeight,
        "z-index": 15
    });

    outsideBlockerBottomLeft.css({
        "background-color": "#000",
        // "background-color": "#00aa00",
        // opacity: .5,
        position: "absolute",
        top: outsideOffset.top + 5,
        left: outsideOffset.left - 5,
        width: outsideWidth,
        height: outsideHeight + 10,
        "z-index": 15
    });

    insideBlockerTopRight.css({
        "background-color": "#000",
        // "background-color": "#0000aa",
        // opacity: .5,
        position: "absolute",
        top: insideOffset.top-3,
        left: insideOffset.left-5,
        width: insideWidth + 15,
        height: insideHeight,
        "z-index": 25
    });

    insideBlockerBottomLeft.css({
        "background-color": "#000",
        // "background-color": "#aa00aa",
        // opacity: .5,
        position: "absolute",
        top: insideOffset.top +5,
        left: insideOffset.left -3,
        width: insideWidth,
        height: insideHeight,
        "z-index": 25
    });

    outsideBlockerTopRight.animate({
        height: 10,
    }, 500).animate({
        width: 0,

    }, 500);

    outsideBlockerBottomLeft.animate({
        width: 20,
    }, 500);

    outsideBlockerBottomLeft.delay(500).animate({
        height: 0,
        top: (outsideOffset.top + outsideHeight)/2,
    }, 500);


    insideBlockerBottomLeft.animate({
        width: 0,
    }, 300);

    insideBlockerTopRight.delay(300).animate({
        height: 10,
    }, 500);

    insideBlockerTopRight.animate({
        width: 0,
        left: insideOffset.left + insideWidth
    }, 500);

    setTimeout(function(){
        outsideBlockerTopRight.remove();
        outsideBlockerBottomLeft.remove();
        insideBlockerTopRight.remove();
        insideBlockerBottomLeft.remove();
    }, 3000);

}

function hideContainer(){
    $(".lt-header").css("visibility", "hidden");
    $(".content-container").css("opacity", 0);
}

function showHeaders(){

    var aHeight = box($("#lt-header-bottom-right")).top - 35;

    setTimeout(function doHeaderAnimations(){

        $(".lt-header-animator-outside").css({visibility: "visible"}).animate({
            top: "25px",
            height: aHeight + 28 + "px"
        }, 500);

        $(".lt-header-animator-inside").css({visibility: "visible"}).delay(100).animate({
            top: "39px",
            height: aHeight + "px"
        }, 500);
    }, 500);

    setTimeout(function showHeaders(){
        $(".lt-header").css("visibility", "visible");
        $(".content-container").css("visibility", "visible");

    }, 1000);

    setTimeout(function hideAnimations(){
        $(".lt-header-animator-outside").css("display", "none");
        $(".lt-header-animator-inside").css("display", "none");
    }, 1000);

}

function showContentBoxes(item, extraDelay) {

    var itemContent = item.find(".content");

    item.removeAttr("style");

    var b = box(item);
    var height = b.height;
    var width = b.width;
    var left = b.left;
    var top = b.top;

    var border = item.css("border");
    var boxShadow = item.css("box-shadow");

    var contentBorder = itemContent.css("border");
    var contentBoxShadow = itemContent.css("box-shadow");

    itemContent.children().each(function(index, element){
        $(element).css("visibility", "hidden");
    });

    item.height(0)
    .width(0)
    .css("top", top + height/2)
    .css("left", left + width/2);

    setTimeout(function doHeaderAnimations(){

        item.animate({
            height: height,
            width: "100%",
            left: left,
            top: top

        }, 500);
        item.css({
            opacity: 1
        });
    }, 1500 + extraDelay);

    setTimeout(function(){

        itemContent.children().each(function(index, element){
            $(element).css("visibility", "visible");
        });


    }, 2200);

}

function hideContentBoxes(){
    var itemContent = item.find(".content");
    itemContent.children().each(function(index, element){
        $(element).css("visibility", "hidden");
    });
}

function showKeyboard(){

    var keyboard = $("#lt-keyboard");
    var spaceBar = $("#k-32");
    var spaceBarWidth = box(spaceBar).width;

    spaceBar.width(0);


    keyboard.delay(2000).animate({
        opacity: 1
    }, 2000);

    spaceBar.delay(2200).animate({
        width: spaceBarWidth
    },500);

}

function hideKeyboard(){
    var keyboard = $("#lt-keyboard");
    keyboard.css("opacity", 0);
}

/* HOUSE .SCAN
 *
 * Replaces Encom's DNA style spline wave. Draws the real house as a wireframe,
 * both floors, from the room rectangles in app/js/rooms.js, with a horizontal
 * scan plane sweeping up through it.
 *
 * Deliberately built on THREE.Geometry, THREE.Line and THREE.LinePieces, which
 * are the r66 API the bundle ships. The r128 renderer belongs to the house
 * widget alone (BUILD.md step 6) and must not be pulled in here.
 */
function createHouseScan(){
    var canvas = document.getElementById('lt-webglCanvas');

    /* Fixed backing store. The whole light table is uniformly zoom scaled, so
       a fixed internal size stays in proportion at every viewport. */
    canvas.width = 734;
    canvas.height = 200;

    var renderer = new THREE.WebGLRenderer({ antialias: true, canvas: canvas });
    renderer.setSize(canvas.width, canvas.height);

    /* A narrow lens well back, so the plan reads flat and even rather than
       with the near end ballooning. The panel is roughly 3.7:1, and the house
       is long, so the framing has to hold through a full turn. */
    var camera = new THREE.PerspectiveCamera(30, canvas.width / canvas.height, 1, 2000);
    camera.position.set(0, 25, 110);

    var scene = new THREE.Scene();
    camera.lookAt(scene.position);

    /* Fit the plan into a box about 110 units along its long axis, centred on
       the origin. The panel is wide and shallow and the house is long, so the
       limit is vertical: the footprint has to stay in frame at every angle of
       the turn, not just side on. */
    var cx = (BOUNDS.x[0] + BOUNDS.x[1]) / 2;
    var cz = (BOUNDS.z[0] + BOUNDS.z[1]) / 2;
    var span = Math.max(BOUNDS.x[1] - BOUNDS.x[0], BOUNDS.z[1] - BOUNDS.z[0]);
    var S = 110 / span;
    var WALL = 244;                        /* wall height in cm, rule 6 */
    var TOP = (LEVEL1_ELEVATION + WALL);   /* top of the upstairs walls */
    var cy = TOP / 2;

    var fx = function(x){ return (x - cx) * S; };
    var fz = function(z){ return (z - cz) * S; };
    var fy = function(y){ return (y - cy) * S; };

    var house = new THREE.Object3D();
    scene.add(house);

    /* One wireframe box per room: floor rectangle, ceiling rectangle, and the
       four corner posts between them. */
    var roomGeometry = new THREE.Geometry();
    var push = function(ax, ay, az, bx, by, bz){
        roomGeometry.vertices.push(new THREE.Vector3(ax, ay, az));
        roomGeometry.vertices.push(new THREE.Vector3(bx, by, bz));
    };

    for(var i = 0; i < ROOMS.length; i++){
        var r = ROOMS[i];
        var base = r.level === 1 ? LEVEL1_ELEVATION : 0;
        var x0 = fx(r.x[0]), x1 = fx(r.x[1]);
        var z0 = fz(r.z[0]), z1 = fz(r.z[1]);
        var y0 = fy(base), y1 = fy(base + WALL);

        /* floor and ceiling outlines */
        var levels = [y0, y1];
        for(var L = 0; L < 2; L++){
            var y = levels[L];
            push(x0, y, z0, x1, y, z0);
            push(x1, y, z0, x1, y, z1);
            push(x1, y, z1, x0, y, z1);
            push(x0, y, z1, x0, y, z0);
        }
        /* corner posts */
        push(x0, y0, z0, x0, y1, z0);
        push(x1, y0, z0, x1, y1, z0);
        push(x1, y0, z1, x1, y1, z1);
        push(x0, y0, z1, x0, y1, z1);
    }

    var roomMaterial = new THREE.LineBasicMaterial({
        color: 0x3fe0ff, opacity: 0, transparent: true
    });
    house.add(new THREE.Line(roomGeometry, roomMaterial, THREE.LinePieces));

    /* Ground outline, so the footprint reads even where no room sits. */
    var groundGeometry = new THREE.Geometry();
    var gx0 = fx(BOUNDS.x[0]), gx1 = fx(BOUNDS.x[1]);
    var gz0 = fz(BOUNDS.z[0]), gz1 = fz(BOUNDS.z[1]);
    var gy = fy(0);
    groundGeometry.vertices.push(new THREE.Vector3(gx0, gy, gz0));
    groundGeometry.vertices.push(new THREE.Vector3(gx1, gy, gz0));
    groundGeometry.vertices.push(new THREE.Vector3(gx1, gy, gz1));
    groundGeometry.vertices.push(new THREE.Vector3(gx0, gy, gz1));
    groundGeometry.vertices.push(new THREE.Vector3(gx0, gy, gz0));
    var groundMaterial = new THREE.LineBasicMaterial({
        color: 0x1d7d91, opacity: 0, transparent: true
    });
    house.add(new THREE.Line(groundGeometry, groundMaterial));

    /* The scan plane: a bright rectangle that rides up through the house. */
    var scanGeometry = new THREE.Geometry();
    scanGeometry.vertices.push(new THREE.Vector3(gx0, 0, gz0));
    scanGeometry.vertices.push(new THREE.Vector3(gx1, 0, gz0));
    scanGeometry.vertices.push(new THREE.Vector3(gx1, 0, gz1));
    scanGeometry.vertices.push(new THREE.Vector3(gx0, 0, gz1));
    scanGeometry.vertices.push(new THREE.Vector3(gx0, 0, gz0));
    var scanMaterial = new THREE.LineBasicMaterial({
        color: 0xbff4ff, opacity: 0, transparent: true
    });
    var scan = new THREE.Line(scanGeometry, scanMaterial);
    house.add(scan);

    /* Dim backdrop rules, kept from the Encom panel for the same depth cue. */
    var backdropGeometry = new THREE.Geometry();
    for(var b = 0; b < 18; b++){
        backdropGeometry.vertices.push(new THREE.Vector3(-110, 32 - b * 4, -80));
        backdropGeometry.vertices.push(new THREE.Vector3(110, 32 - b * 4, -80));
    }
    var backdropMaterial = new THREE.LineBasicMaterial({
        color: 0x1b2f2d, opacity: 0, transparent: true
    });
    scene.add(new THREE.Line(backdropGeometry, backdropMaterial, THREE.LinePieces));

    renderer.render(scene, camera);

    var scanBottom = fy(0) - 2;
    var scanTop = fy(TOP) + 2;
    var firstRun = null;
    var lastFrame = Date.now();

    return {
        tick: function(){
            var now = Date.now();
            if(firstRun === null){
                firstRun = now;
            }
            var dt = Math.min(now - lastFrame, 100);
            lastFrame = now;

            /* Fade in over the first 3 seconds, same timing Encom used. */
            var age = now - firstRun;
            var fade = Math.min(1, age / 3000);
            roomMaterial.opacity = fade;
            groundMaterial.opacity = fade * 0.7;
            backdropMaterial.opacity = fade * 0.333;
            scanMaterial.opacity = fade;

            /* One turn every 24 seconds. */
            house.rotation.y += (2 * Math.PI) * dt / 24000;

            /* Scan rides bottom to top every 4 seconds, then restarts. */
            var phase = (age % 4000) / 4000;
            scan.position.y = scanBottom + (scanTop - scanBottom) * phase;

            renderer.render(scene, camera);
        },
        reset: function(){
            firstRun = null;
        }
    };

}

function hideWebgl(){
    $('#lt-bandwidth').css("opacity", 0);
}

function writeResponse(txt){
    $("#lt-command-lines").append("<div class='response'>&gt;&gt;muther: " + txt + "</div>");
}

var currentDir = "sys";

function writePrompt(){
    $(".command-blinker").removeClass("blink").removeClass("command-blinker");

    var path = currentDir === "sys" ? "~" : "~/" + currentDir;
    $("#lt-command-lines").append('<div class="command"><span class="prompt">muther@sys:' + path + '$&nbsp;</span><span class="command-text"></span><span class="blink command-blinker">&nbsp;</span></div>');
}

function writeLs(exec){
    var output = "";
    if(typeof exec != "undefined"){
        output = [
            '<div class="ls">sys</div>',
            '<div class="ls">entities</div>',
            '<div class="ls">rooms</div>',
            '<div class="ls">muther</div>',
            '<div class="ls ls-exec">' + exec + '</div>',
            '<div class="ls">house_scan</div>',
            '<div class="ls">scenes</div>',
            '<div class="ls">&nbsp;</div>',
            '<div class="ls">automations</div>',
            '<div class="ls">logbook</div>',
        ].join('');

    } else {
        output = systems.filter(function(system){
            return !system.hidden;
        }).map(function(system){
            return '<div class="ls ls-' + system.key + '">' + system.key + '</div>';
        }).join('');
    }

    $("#lt-command-lines").append(output);

}


/* ---------------------------------------------------------------------------
   MUTHER
   The README tells Jovan to type status, lights off and arm away, so those
   have to work. They read and act through the one Home Assistant connection
   in ha-source.js. Service calls are asynchronous, so those branches write
   the prompt from the callback instead of straight away, which is why
   runCommand returns a flag saying whether it already handled the prompt.
   --------------------------------------------------------------------------- */

var HELP = [
    ["status", "lights, alerts, temperature and what is open"],
    ["lights off", "turn off every light that is on"],
    ["arm away", "arm the alarm panel in away mode"],
    ["help", "this list"],
    ["ls", "list the systems"],
    ["cd &lt;system&gt;", "select a system"],
    ["run &lt;system&gt;.exe", "open that system's screen"]
];

/* Every entity whose id starts with one of the given domains. */
function entitiesIn(domains){
    var out = [];
    if(!ha){
        return out;
    }
    ha.states.forEach(function(state, id){
        for(var i = 0; i < domains.length; i++){
            if(id.indexOf(domains[i] + ".") === 0){
                out.push(state);
                return;
            }
        }
    });
    return out;
}

function nameOf(state){
    return (state.attributes && state.attributes.friendly_name) || state.entity_id;
}

/* True once the connection has finished its first load of every state. */
function haReady(){
    return ha && ha.states && ha.states.size > 0;
}

function needHa(){
    writeResponse("<span class='alert'>No link.</span> Home Assistant is not connected yet.");
    return false;
}

function doStatus(){
    if(!haReady()){
        return needHa();
    }

    var lightsOn = [], alerts = [], temps = [], seenRooms = {}, i;

    ha.states.forEach(function(st, id){
        if(id.indexOf("light.") === 0 && st.state === "on"){
            lightsOn.push(st);
        }
        if(msg.severityFor(id, st) === msg.Severity.ALERT){
            alerts.push(st);
        }
        var attrs = st.attributes || {};
        if(id.indexOf("sensor.") === 0 && attrs.device_class === "temperature"){
            var t = Number(st.state);
            if(isFinite(t)){
                temps.push(t);
            }
        }
        var room = rooms.roomForEntity(st);
        if(room){
            seenRooms[room.key] = true;
        }
    });

    var avg = null;
    if(temps.length){
        var sum = 0;
        for(i = 0; i < temps.length; i++){
            sum += temps[i];
        }
        avg = sum / temps.length;
    }

    var roomCount = 0, k;
    for(k in seenRooms){
        if(seenRooms.hasOwnProperty(k)){
            roomCount++;
        }
    }

    writeResponse(
        ha.states.size + " entities across " + roomCount + " rooms. " +
        "<span class='highlight'>" + lightsOn.length + "</span> light" +
        (lightsOn.length === 1 ? "" : "s") + " on. " +
        (avg === null ? "No temperature reading." : "Average " + avg.toFixed(1) + " degrees."));

    if(alerts.length){
        var names = [];
        /* Three names keeps this a summary. SECURITY has the full list. */
        for(i = 0; i < alerts.length && i < 3; i++){
            names.push(nameOf(alerts[i]));
        }
        writeResponse("<span class='alert'>" + alerts.length + " need" +
            (alerts.length === 1 ? "s" : "") + " you:</span> " + names.join(", ") +
            (alerts.length > 3 ? ", and " + (alerts.length - 3) + " more" : ""));
    } else {
        writeResponse("Nothing needs you. All clear.");
    }

    return false;
}

/* Shared tail for the two commands that change something in the house. */
function afterService(promise, done){
    promise.then(function(){
        writeResponse(done);
        writePrompt();
        scrollTerminal();
    }).catch(function(err){
        writeResponse("<span class='alert'>Error:</span> " + (err && err.message ? err.message : "service call failed"));
        writePrompt();
        scrollTerminal();
    });
    return true;
}

function doLightsOff(){
    if(!haReady()){
        return needHa();
    }

    var on = [];
    ha.states.forEach(function(st, id){
        if(id.indexOf("light.") === 0 && st.state === "on"){
            on.push(id);
        }
    });

    if(!on.length){
        writeResponse("No lights are on.");
        return false;
    }

    writeResponse("Turning off " + on.length + " light" + (on.length === 1 ? "" : "s") + "...");
    return afterService(
        ha.callService("light", "turn_off", {}, { entity_id: on }),
        "<span class='highlight'>Done.</span> " + on.length + " light" +
            (on.length === 1 ? "" : "s") + " off.");
}

function doArmAway(){
    if(!haReady()){
        return needHa();
    }

    var panels = entitiesIn(["alarm_control_panel"]);
    if(!panels.length){
        writeResponse("<span class='alert'>No alarm panel</span> in Home Assistant.");
        return false;
    }

    var ids = [], names = [], i;
    for(i = 0; i < panels.length; i++){
        ids.push(panels[i].entity_id);
        names.push(nameOf(panels[i]));
    }

    writeResponse("Arming away: " + names.join(", ") + "...");
    return afterService(
        ha.callService("alarm_control_panel", "alarm_arm_away", {}, { entity_id: ids }),
        "<span class='highlight'>Armed away.</span> Watch the doors.");
}

function doHelp(){
    var out = "", i;
    for(i = 0; i < HELP.length; i++){
        out += '<div class="response"><span class="highlight">' + HELP[i][0] +
               '</span> ' + HELP[i][1] + '</div>';
    }
    $("#lt-command-lines").append(out);
    return false;
}

function scrollTerminal(){
    var cl = $("#lt-command-lines");
    $("#lt-command-line").scrollTop(cl.height());
}

function executeCommand(){
    var command = $(".command-text").last().text();

    /* "run <system>.exe" launches a screen, "cd <system>" selects its folder.
       Both are resolved against src/systems.js rather than hardcoded. */
    var runMatch = /^run ([a-z0-9_]+)\.exe$/.exec(command);
    var cdMatch  = /^cd ([a-z0-9_]+)$/.exec(command);
    var runSystem = runMatch ? systemByKey(runMatch[1]) : null;
    var cdSystem  = cdMatch  ? systemByKey(cdMatch[1])  : null;

    /* MUTHER's own verbs come first, so "status" is never mistaken for a
       missing file. A handler returns true when it has already written the
       next prompt itself, which the asynchronous ones do from a callback. */
    var handler = command === "status" ? doStatus
        : command === "lights off" ? doLightsOff
        : command === "arm away" ? doArmAway
        : command === "help" || command === "?" ? doHelp
        : null;

    if(handler){
        if(!handler()){
            writePrompt();
        }
        scrollTerminal();
        return;
    }

    if(runSystem){
        if(currentDir == runSystem.key){
            $(".ls-exec").addClass("ls-highlight");
            $(".container-border").animate({opacity: 0}, 500);

            setTimeout(function(){
                hideFn(runSystem.key);
            }, 500);
        } else {
            writeResponse("<span class='alert'>Error:</span> No such file");
            writePrompt();
        }

    } else if(cdSystem){
        $(".ls-" + cdSystem.key).addClass("ls-highlight");
        currentDir = cdSystem.key;
        $(".folder-label").removeClass("selected");
        $("#lt-launch-" + cdSystem.key + " .folder-label").addClass("selected");
        writeResponse("Changed directory to <span class='highlight'>" + cdSystem.key + "</span>");
        writePrompt();

    } else if(command.indexOf("cd sys") == 0 || command == "cd /" || command == "cd ~"){
        currentDir = "sys";
        writeResponse("Changed directory to <span class='highlight'>sys</span>");
        writePrompt();
    } else if(command.indexOf("cd ") == 0){
        writeResponse("<span class='alert'>Access denied</span>");
        writePrompt();
    } else if(command.indexOf("ls") == 0 && currentDir == "sys"){
        writeLs();
        writePrompt();

    } else if(command.indexOf("ls") == 0){
        writeLs(currentDir + ".exe");
        writePrompt();

    } else if(command.indexOf("run") == 0){
        writeResponse("<span class='alert'>Access denied</span>");
        writePrompt();
    } else if(command.length){
        writeResponse("unknown command, type <span class='highlight'>help</span>");
        writePrompt();
    } else {
        writePrompt();
    }

    scrollTerminal();

}

var keyBuffer = [];
var keysRunning = false;

function runKeySimulator(){
    var key = keyBuffer.shift();

    keyClick(key);

    if(keyBuffer.length > 0){
        setTimeout(runKeySimulator,10 + Math.random() * 150);
    } else {
        keysRunning = false;
    }

}

function simulateKey(key){
    keyBuffer.push(key);
    if(!keysRunning){
        keysRunning = true;
        setTimeout(runKeySimulator,100);
    }
}

function simulateCommand(command){
    var cs = command.split("");
    for(var i = 0; i < cs.length; i++){
        simulateKey(charToKeyCode(cs[i]));
    }

}

function charToKeyCode(char){
    var cc = char.charCodeAt(0);
    if(cc <= 122 && cc >=97){
        return cc - 32;
    } else if (char === "."){
        return 190;
    } else if (char === " "){
        return 32;
    } else if (char === "$"){
        return 13;
    } else if (char === "|"){
        return 27; 
    }

    return 0;

}

function toggleKey(element){
    element.css({
        "background-color": "#fff",
        "color": "#000"
    });

    setTimeout(function(){
        element.css({
            "background-color": "#888",
            "color": "#888"
        });
    }, 200);
    setTimeout(function(){
        element.css({
            "background-color": "#000",
            "color": "#00eeee"
        });
    }, 300);
}

function writeKeyStroke(keycode){
    var txt = $(".command-text").last();
    switch(keycode){
        case 8: 
            txt.text(txt.text().substring(0,txt.text().length-1));
        break;
        case 27: 
            txt.text("");
        break;
        case 13:
            executeCommand();
        break;
        case 189:
            txt.append("_");
        break;
        case 187:
            txt.append("=");
        break;
        case 219:
            txt.append("{");
        break;
        case 221:
            txt.append("}");
        break;
        case 186:
            txt.append(";");
        break;
        case 222:
            txt.append("'");
        break;
        case 188:
            txt.append(",");
        break;
        case 190:
            txt.append(".");
        break;
        case 191:
            txt.append("/");
        break;
        case 192:
            txt.append("~");
        break;
        case 500:
            txt.append("");
        break;
        default:
            var key = String.fromCharCode(keycode).toLowerCase();
        txt.append(key)
    };

}

function keyClick(keycode){

    // light up the keyboard

    toggleKey($("#k-" + keycode));

    if(keycode === 16){
        toggleKey($("#k-0"));
    }

    // write it to the screen
    writeKeyStroke(keycode);

}

module.exports = LightTable;
