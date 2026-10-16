var $ = require("jquery"),
    Boardroom = require("./Boardroom.js"),
    LightTable = require("./LightTable.js"),
    PleaseRotate = require("pleaserotate.js"),
    systems = require("./systems.js"),
    haSource = require("./ha-source.js"),
    HouseView = require("./HouseView.js").HouseView,
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
haSource.start(function(message){

    if(active === "lt"){
        LightTable.message(message);
    } else if(active === "house"){
        HouseView.message(message);
    } else {
        /* Encom staggered incoming events so the widgets do not all fire on
           the same frame. A busy house is burstier than GitHub was, so keep it. */
        setTimeout(function(){
            Boardroom.message(message);
        }, 3000 * Math.random());
    }

}, function(state){
    /* Connection state, visible in the console and on the boot panel. */
    console.log("home assistant: " + state.status + (state.detail ? " (" + state.detail + ")" : ""));
    $("#ha-link").text("HOME ASSISTANT ... " + String(state.status).toUpperCase());
});

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
        HouseView.init();
        HouseView.seed(haSource.getSeed());

        setTimeout(function(){
            active = "house";
            HouseView.show();
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
    $("#light-table").fitScreen();
    $("#boardroom").fitScreen(1900, 715);
    LightTable.show();

    var animate = function(){

        if(active === "lt"){
            LightTable.animate();
        } else if(active === "house"){
            HouseView.animate();
        } else {
            Boardroom.animate()
        }

        requestAnimationFrame(animate);
    };

    animate();

    var timeout = 0;
    function onWindowResize(){

        if(active === "lt"){
            $("#light-table").fitScreen();
            LightTable.resize();
        } else if(active === "house"){
            /* The House screen is a CSS grid at 100vw by 100vh, so it needs no
               scaling, only a debounced nudge so its widgets resize with it. */
            HouseView.resizeDebounced();
        } else {
            Boardroom.resize();
        }
    }

    window.addEventListener( 'resize', onWindowResize, false );

}});

