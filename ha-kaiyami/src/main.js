var $ = require("jquery"),
    Boardroom = require("./Boardroom.js"),
    LightTable = require("./LightTable.js"),
    PleaseRotate = require("pleaserotate.js"),
    systems = require("./systems.js"),
    haSource = require("./ha-source.js"),
    HouseView = require("./HouseView.js").HouseView,
    ClimateView = require("./ClimateView.js").ClimateView,
    SecurityView = require("./SecurityView.js").SecurityView,
    CameraView = require("./CameraView.js").CameraView,
    EnergyView = require("./EnergyView.js").EnergyView,
    HomelabView = require("./HomelabView.js").HomelabView,
    Areas = require("./Areas.js").Areas,
    LeakWatch = require("./LeakWatch.js").LeakWatch,
    areas = null,
    leaks = null,
    init = false;

require("jquery-ui");

/* Scale a screen so it fills the window instead of sitting at native size in
   the middle of it. Encom scaled the boardroom off width alone and never
   scaled the light table at all, so on anything but a 1918px wide display the
   launcher rendered small and centred. */
$.fn.fitScreen = function (baseW, baseH) {
    var el = this;

    /* Measure unscaled, otherwise the previous zoom skews the result. */
    el.css({zoom: 1, "-moz-transform": "none"});
    var w = baseW || el.outerWidth();
    var h = baseH || el.outerHeight();
    if(!w || !h){
        return el;
    }

    /* min, not max: the boardroom is a 2.7:1 layout, so filling both axes
       would crop it. This fills whichever axis binds and centres the rest. */
    var ratio = Math.min($(window).width() / w, $(window).height() / h);

    el.css({
        zoom: ratio,
        "-moz-transform": "scale(" + ratio + ")",
        "-moz-transform-origin": "0 0"
    });

    return el.center(ratio);
};

/* Scale the launcher to fill the whole viewport.
   fitScreen above centres a fixed size screen and leaves bands around it,
   which is right for the boardroom but wrong for the launcher: the launcher
   is the frame, so any band reads as a border that should not be there.
   Both launcher layouts are 16:9, so at 1920x1080, 2560x1440 and 1366x768 the
   two scale factors are equal and nothing is distorted. On an off ratio
   display it stretches to fill rather than letterboxing.
   transform, not zoom: a transformed element becomes the containing block for
   its position:fixed descendants, which keeps the two frame borders locked to
   the launcher instead of drifting against the viewport. */
$.fn.fitLauncher = function () {
    var el = this;

    el.css("transform", "none");
    var w = el.outerWidth();
    var h = el.outerHeight();
    if(!w || !h){
        return el;
    }

    el.css({
        position: "fixed",
        top: 0,
        left: 0,
        "transform-origin": "0 0",
        transform: "scale(" + ($(window).width() / w) + "," + ($(window).height() / h) + ")"
    });

    return el;
};

$.fn.center = function (scale) {

    var top = Math.max(0, (($(window).height() - $(this).outerHeight()) / 2) + $(window).scrollTop());
    var left = Math.max(0, (($(window).width() - $(this).outerWidth()) / 2) + $(window).scrollLeft());

    if(scale){
        top = Math.max(0, (($(window).height() - $(this).outerHeight() * scale) / 2) + $(window).scrollTop());
        left = Math.max(0, (($(window).width() - $(this).outerWidth() * scale) / 2) + $(window).scrollLeft());
    }

    this.css("position","fixed");
    this.css("top", top + "px");
    this.css("left", left + "px");
    return this;
}

var active = "lt";

/* One connection for the whole dashboard. Messages go to whichever screen is
   showing, exactly as Encom's EventSource listener did. Boardroom.message
   ignores anything whose stream is not the active system, so each screen only
   sees its own traffic. */
var ha = haSource.start(function(message){

    if(active === "lt"){
        LightTable.message(message);
    } else if(active === "house"){
        HouseView.message(message);
    } else if(active === "climate"){
        ClimateView.message(message);
    } else if(active === "security"){
        SecurityView.message(message);
    } else if(active === "cameras"){
        CameraView.message(message);
    } else if(active === "energy"){
        EnergyView.message(message);
    } else if(active === "homelab"){
        HomelabView.message(message);
    } else {
        /* Encom staggered incoming events so the widgets do not all fire on
           the same frame. A busy house is burstier than GitHub was, so keep it. */
        setTimeout(function(){
            Boardroom.message(message);
        }, 3000 * Math.random());
    }

}, function(state){
    /* Connection state, visible in the console and on the launcher. */
    console.log("home assistant: " + state.status + (state.detail ? " (" + state.detail + ")" : ""));
    $("#ha-link").text("MUTHER ... HOME ASSISTANT " + String(state.status).toUpperCase());
    LightTable.setLink(state.status === "ready");

    /* Read the registries as soon as the connection is usable. load() is
       memoised on success, so a reconnect does not refetch them. */
    if(state.status === "ready" && areas){
        areas.load();
    }
});

/* MUTHER runs commands against the same connection the screens read from.
   start() returns null when there is no config, and the terminal says so
   rather than failing silently. */
LightTable.setHomeAssistant(ha);

/* The area registry, read once and shared by every screen. Nothing guesses a
   room from a friendly name any more.
   It is loaded from the status callback rather than here, because the
   registries are a command on the socket and the socket has not finished
   authenticating at this point in the file. */
areas = new Areas(ha);

/* A leak outranks whatever is on screen, so this watches the whole house all
   the time rather than only while the Security screen is open. */
leaks = new LeakWatch(ha, areas);
leaks.start();

var onSwitch = function(view){
    var screensaver = $("#screensaver");
    var system = null;

    for(var i = 0; i < systems.length; i++){
        if(systems[i].key === view){
            system = systems[i];
        }
    }

    if(!system){
        return;
    }

    screensaver.center();
    screensaver.css({visibility: "visible"});
    screensaver.text(system.splash);

    screensaver.delay(3000).animate({ opacity: 0 },{
        step: function(now, tween){
            screensaver.css('transform', 'scale(' + now + ',' + now + '');
        },
        duration: 600,
        easing: "easeInOutBack"});

    LightTable.hide();

    if(system.key === "house"){
        /* init lays the screen out but leaves it invisible, so the splash is
           what you see for these three seconds. show() reveals it, exactly
           the way Boardroom.init and Boardroom.show divide the work. */
        HouseView.init(ha);
        HouseView.seed(haSource.getSeed());

        setTimeout(function(){
            active = "house";
            HouseView.show();
        }, 3000);

    } else if(system.key === "climate"){
        ClimateView.init(ha);
        ClimateView.seed(haSource.getSeed());

        setTimeout(function(){
            active = "climate";
            ClimateView.show();
        }, 3000);

    } else if(system.key === "security"){
        SecurityView.init(ha, areas);
        SecurityView.seed(haSource.getSeed());

        setTimeout(function(){
            active = "security";
            SecurityView.show();
        }, 3000);

    } else if(system.key === "cameras"){
        CameraView.init(ha, areas);
        CameraView.seed(haSource.getSeed());

        setTimeout(function(){
            active = "cameras";
            CameraView.show();
        }, 3000);

    } else if(system.key === "energy"){
        EnergyView.init(ha, areas);
        EnergyView.seed(haSource.getSeed());

        setTimeout(function(){
            active = "energy";
            EnergyView.show();
        }, 3000);

    } else if(system.key === "homelab"){
        /* A placeholder screen for now: nothing scrapes Proxmox or the
           services yet, so there is no data to draw. It still goes through
           init then show so the splash covers the same three seconds the
           other systems take. */
        HomelabView.init();

        setTimeout(function(){
            active = "homelab";
            HomelabView.show();
        }, 3000);

    } else {
        Boardroom.init(system.key);

        setTimeout(function(){
            active = "br";
            Boardroom.show();
        }, 3000);
    }

    /* Development stream, no Home Assistant needed. BUILD.md step 5 keeps it. */
    if(system.key === "test"){
        setInterval(function(){
            if(Boardroom){
                Boardroom.message({
                    stream: 'test',
                    latlon: {
                        lat: Math.random() * 180 - 90,
                        lon: Math.random() * 360 - 180
                    },
                    location: 'Test ' + Math.floor(Math.random() * 100),
                    type: 'Type ' + Math.floor(Math.random() * 8),
                    picSmall: 'images/not_available_small.png',
                    picLarge: 'images/not_available_large.png',
                    username: "arscan" + Math.floor(Math.random()*1000),
                    userurl: "http://github.com/arscan",
                    title: "Test " + Math.floor(Math.random() * 100),
                    url: "http://github.com/arscan/encom-boardroom/",
                    size: Math.floor(Math.random()*10000),
                    popularity: Math.floor(Math.random()*10000)
                });
            }
        }, 800);
    }

};

PleaseRotate.start({onHide: function(){
    if(init){
        return;
    }
    init = true;
    try {
        LightTable.init(onSwitch);

    } catch (ex){

        
        $("#error-message")
           .css("visibility", "visible")
           .center();

        console.log(ex);

        return;


    }
    $("#light-table").fitLauncher();
    $("#boardroom").fitScreen(1900, 715);
    LightTable.show();

    var animate = function(){

        if(active === "lt"){
            LightTable.animate();
        } else if(active === "house"){
            HouseView.animate();
        } else if(active === "climate"){
            ClimateView.animate();
        } else if(active === "security"){
            SecurityView.animate();
        } else if(active === "cameras"){
            CameraView.animate();
        } else if(active === "energy"){
            EnergyView.animate();
        } else if(active === "homelab"){
            HomelabView.animate();
        } else {
            Boardroom.animate()
        }

        requestAnimationFrame(animate);
    };

    animate();

    var timeout = 0;
    function onWindowResize(){

        if(active === "lt"){
            $("#light-table").fitLauncher();
            LightTable.resize();
        } else if(active === "house"){
            /* The House screen is a CSS grid at 100vw by 100vh, so it needs no
               scaling, only a debounced nudge so its widgets resize with it. */
            HouseView.resizeDebounced();
        } else if(active === "climate"){
            ClimateView.resizeDebounced();
        } else if(active === "security"){
            SecurityView.resizeDebounced();
        } else if(active === "cameras"){
            CameraView.resizeDebounced();
        } else if(active === "energy"){
            EnergyView.resizeDebounced();
        } else if(active === "homelab"){
            HomelabView.resizeDebounced();
        } else {
            Boardroom.resize();
        }
    }

    window.addEventListener( 'resize', onWindowResize, false );

}});

