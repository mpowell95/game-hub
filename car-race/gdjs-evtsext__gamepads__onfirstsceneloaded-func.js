
if (typeof gdjs.evtsExt__Gamepads__onFirstSceneLoaded !== "undefined") {
  gdjs.evtsExt__Gamepads__onFirstSceneLoaded.registeredGdjsCallbacks.forEach(callback =>
    gdjs._unregisterCallback(callback)
  );
}

gdjs.evtsExt__Gamepads__onFirstSceneLoaded = {};
gdjs.evtsExt__Gamepads__onFirstSceneLoaded.idToCallbackMap = new Map();


gdjs.evtsExt__Gamepads__onFirstSceneLoaded.userFunc0xb0dac8 = function GDJSInlineCode(runtimeScene, eventsFunctionContext) {
"use strict";
if (gdjs._extensionController) {
    return;
}

/**
 *  Associate controller button ids to button names
 */
const controllerButtonNames = {
    "XBOX": {
        0: "A",
        1: "B",
        2: "X",
        3: "Y",
        4: "LB",
        5: "RB",
        6: "LT",
        7: "RT",
        8: "BACK",
        9: "START",
        10: "CLICK_STICK_LEFT",
        11: "CLICK_STICK_RIGHT",
        12: "UP",
        13: "DOWN",
        14: "LEFT",
        15: "RIGHT",
        16: "NONE",
        17: "NONE"
    },
    "PS4": {
        0: "CROSS",
        1: "CIRCLE",
        2: "SQUARE",
        3: "TRIANGLE",
        4: "L1",
        5: "R1",
        6: "L2",
        7: "R2",
        8: "SHARE",
        9: "OPTIONS",
        10: "CLICK_STICK_LEFT",
        11: "CLICK_STICK_RIGHT",
        12: "UP",
        13: "DOWN",
        14: "LEFT",
        15: "RIGHT",
        16: "PS_BUTTON",
        17: "CLICK_TOUCHPAD"
    }
};

/**
 * @param {number} playerId
 */
function getGamepad(playerId) {
    /** @type {Gamepad[]} */
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    return gamepads[playerId];
}

/** @type {{[playerId: number]: Player}} */
const players = {};

/**
 * @param {number} playerId
 */
function getPlayer(playerId) {
    let player = players[playerId];
    if (!player) {
        player = new Player(playerId);
        players[playerId] = player;
    }
    return player;
}

class Player {
    /** @type {number} */
    playerId;
    mapping = 'DEFAULT';
    lastButtonUsed = -1;
    deadzone = 0.2;
    /** @type {{[buttonId: number]: ButtonState}} */
    buttonStates = {};
    rumble = { elapsedTime: 0, duration: 0, weakMagnitude: 0, strongMagnitude: 0 };

    /**
     * @param {number} playerId
     */
    constructor(playerId) {
        this.playerId = playerId;
    }

    /**
     * @param {number} buttonId
     */
    getButtonState(buttonId) {
        let buttonState = this.buttonStates[buttonId];
        if (!buttonState) {
            buttonState = new ButtonState();
            this.buttonStates[buttonId] = buttonState;
        }
        return buttonState;
    }

    /**
     * @param {number} buttonId
     */
    isButtonPressed(buttonId) {
        return this.getButtonState(buttonId).isPressed;
    }

    /**
     * @param {number} buttonId
     */
    isButtonJustPressed(buttonId) {
        return this.getButtonState(buttonId).isJustPressed();
    }

    /**
     * @param {number} buttonId
     */
    isButtonReleased(buttonId) {
        return this.getButtonState(buttonId).isReleased();
    }

    isAnyButtonReleased() {
        for (const buttonId in this.buttonStates) {
            const buttonState = this.buttonStates[buttonId];
            if (buttonState.isReleased()) {
                return true;
            }
        }
        return false;
    }

    isAnyButtonPressed() {
        for (const buttonId in this.buttonStates) {
            const buttonState = this.buttonStates[buttonId];
            if (buttonState.isPressed) {
                return true;
            }
        }
        return false;
    }
}

class ButtonState {
    wasPressed = false;
    isPressed = false;

    isReleased() {
        return this.wasPressed && !this.isPressed;
    }

    isJustPressed() {
        return !this.wasPressed && this.isPressed;
    }
}

// Async tasks are run before everything.
// This is a hack to make sure that button states are updated
// before mapping behavior events.
const frameBeginningTask = new class extends gdjs.AsyncTask {
    update() {
        /** @type {Gamepad[]} */
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (let playerId = 0; playerId < gamepads.length; playerId++) {
            const gamepad = gamepads[playerId];
            if (gamepad == null) {
                // The gamepad is not connected.
                continue;
            }
            const player = getPlayer(playerId);

            for (let buttonId = 0; buttonId < Object.keys(gamepad.buttons).length; buttonId++) {
                const buttonState = player.getButtonState(buttonId);
                buttonState.wasPressed = buttonState.isPressed;
                buttonState.isPressed = gamepad.buttons[buttonId].pressed;
                if (buttonState.isJustPressed()) {
                    player.lastButtonUsed = buttonId;
                }
            }
        }
        return false;
    }
}();

function onScenePostEvents() {
    /** @type {Gamepad[]} */
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let playerId = 0; playerId < gamepads.length; playerId++) {
        let gamepad = gamepads[playerId];
        if (gamepad == null) {
            // The gamepad is not connected.
            continue;
        }
        const player = getPlayer(playerId);
        const rumble = player.rumble;
        rumble.elapsedTime += runtimeScene.getElapsedTime(runtimeScene) / 1000;
        if (rumble.duration - rumble.elapsedTime <= 0 &&
            (rumble.weakMagnitude || rumble.strongMagnitude)
        ) {
            rumble.weakMagnitude = 0;
            rumble.strongMagnitude = 0;
        }
    }
}

/**
 * @param {string} type
 * @param {number} buttonId
 */
function getInputString(type, buttonId) {
    if (!controllerButtonNames[type]) {
        return "UNKNOWN_BUTTON";
    }
    return controllerButtonNames[type][buttonId];
}

function getButtonId(buttonName) {
    switch (buttonName) {
        case 'A':
        case 'CROSS':
            return 0;
        case 'B':
        case 'CIRCLE':
            return 1;
        case 'X':
        case 'SQUARE':
            return 2;
        case 'Y':
        case 'TRIANGLE':
            return 3;
        case 'LB':
        case 'L1':
            return 4;
        case 'RB':
        case 'R1':
            return 5;
        case 'LT':
        case 'L2':
            return 6;
        case 'RT':
        case 'R2':
            return 7;
        case 'UP':
            return 12;
        case 'DOWN':
            return 13;
        case 'LEFT':
            return 14;
        case 'RIGHT':
            return 15;
        case 'BACK':
        case 'SHARE':
            return 8;
        case 'START':
        case 'OPTIONS':
            return 9;
        case 'CLICK_STICK_LEFT':
            return 10;
        case 'CLICK_STICK_RIGHT':
            return 11;
        //PS4
        case 'PS_BUTTON':
            return 16;
        case 'CLICK_TOUCHPAD':
            return 17;
        default:
            console.error('The gamepad button: ' + buttonName + ' is not valid.');
            return null;
    }
}

/**
 * @param {number} playerId
 * @param {string} directionName
 * @param {number} axisValueX
 * @param {number} axisValueY
 */
function isAxisPushed(playerId, directionName, axisValueX, axisValueY) {
    switch (directionName) {
        case 'LEFT':
            return getNormalizedAxisValue(axisValueX, playerId) < 0;
        case 'RIGHT':
            return getNormalizedAxisValue(axisValueX, playerId) > 0;
        case 'UP':
            return getNormalizedAxisValue(axisValueY, playerId) < 0;
        case 'DOWN':
            return getNormalizedAxisValue(axisValueY, playerId) > 0;
        case 'ANY':
            return getNormalizedAxisValue(axisValueX, playerId) < 0
                || getNormalizedAxisValue(axisValueX, playerId) > 0
                || getNormalizedAxisValue(axisValueY, playerId) < 0
                || getNormalizedAxisValue(axisValueY, playerId) > 0
        default:
            console.error('The value stick direction is not valid.');
            return false;
    }
}

/**
 * @param {number} deltaX
 * @param {number} deltaY
 */
function axisToAngle(deltaX, deltaY) {
    const rad = Math.atan2(deltaY, deltaX);
    const deg = rad * (180 / Math.PI);
    return deg;
}

/**
 * @param {{id: string}} gamepad
 */
function isXbox(gamepad) {
    return (gamepad ? (
        gamepad.id.toUpperCase().indexOf("XBOX") !== -1
        // "XINPUT" cannot be used to check if it is a xbox controller is just a generic
        // name reported in Firefox corresponding to the driver being used by the controller
        // https://gamefaqs.gamespot.com/boards/916373-pc/73341312?page=1
    ) : false);
}

/**
 * Returns the new value taking into account the dead zone for the player_ID given
 * @param {number} value
 * @param {number} playerID
 */
function getNormalizedAxisValue(value, playerID) {
    //    gdjs._extensionController = gdjs._extensionController || { deadzone: 0.2 };

    // Anything smaller than this is assumed to be 0,0
    const deadzone = getPlayer(playerID).deadzone;

    if (Math.abs(value) < deadzone) {
        return 0;
    } else {
        // We're outside the dead zone, but we'd like to smooth
        // this value out so it still runs nicely between 0..1.
        // That is, we don't want it to jump suddenly from 0 to
        // deadzone.

        // Remap value from
        //    deadzone..1 to 0..(1-deadzone)
        // or from
        //    -1..-deadzone to -(1-deadzone)..0
        value = value - Math.sign(value) * deadzone;

        // Remap value from
        //    0..(1-deadzone) to 0..1
        // or from
        //    -(1-deadzone)..0 to -1..0
        return value / (1 - deadzone);
    }
}

gdjs._extensionController = {
    getPlayer,
    controllerButtonNames,
    getInputString,
    getButtonId,
    axisToAngle,
    isXbox,
    getNormalizedAxisValue,
    isAxisPushed,
    getGamepad,
    onScenePostEvents,
    frameBeginningTask,
}
};
gdjs.evtsExt__Gamepads__onFirstSceneLoaded.eventsList0 = function(runtimeScene, eventsFunctionContext) {

{


gdjs.evtsExt__Gamepads__onFirstSceneLoaded.userFunc0xb0dac8(runtimeScene, eventsFunctionContext);

}


};

gdjs.evtsExt__Gamepads__onFirstSceneLoaded.func = function(runtimeScene, parentEventsFunctionContext) {
let scopeInstanceContainer = null;
var eventsFunctionContext = {
  _objectsMap: {
},
  _objectArraysMap: {
},
  _behaviorNamesMap: {
},
  globalVariablesForExtension: runtimeScene.getGame().getVariablesForExtension("Gamepads"),
  sceneVariablesForExtension: runtimeScene.getScene().getVariablesForExtension("Gamepads"),
  localVariables: [],
  getObjects: function(objectName) {
    return eventsFunctionContext._objectArraysMap[objectName] || [];
  },
  getObjectsLists: function(objectName) {
    return eventsFunctionContext._objectsMap[objectName] || null;
  },
  getBehaviorName: function(behaviorName) {
    return eventsFunctionContext._behaviorNamesMap[behaviorName] || behaviorName;
  },
  createObject: function(objectName) {
    const objectsList = eventsFunctionContext._objectsMap[objectName];
    if (objectsList) {
      const object = parentEventsFunctionContext && !(scopeInstanceContainer && scopeInstanceContainer.isObjectRegistered(objectName)) ?
        parentEventsFunctionContext.createObject(objectsList.firstKey()) :
        runtimeScene.createObject(objectsList.firstKey());
      if (object) {
        objectsList.get(objectsList.firstKey()).push(object);
        if (!(scopeInstanceContainer && scopeInstanceContainer.isObjectRegistered(objectName))) {
          eventsFunctionContext._objectArraysMap[objectName].push(object);
        }
      }
      return object;
    }
    return null;
  },
  getInstancesCountOnScene: function(objectName) {
    const objectsList = eventsFunctionContext._objectsMap[objectName];
    let count = 0;
    if (objectsList) {
      for(const objectName in objectsList.items)
        count += parentEventsFunctionContext && !(scopeInstanceContainer && scopeInstanceContainer.isObjectRegistered(objectName)) ?
parentEventsFunctionContext.getInstancesCountOnScene(objectName) :
        runtimeScene.getInstancesCountOnScene(objectName);
    }
    return count;
  },
  getLayer: function(layerName) {
    return runtimeScene.getLayer(layerName);
  },
  getArgument: function(argName) {
    return "";
  },
  getOnceTriggers: function() { return runtimeScene.getOnceTriggers(); }
};


gdjs.evtsExt__Gamepads__onFirstSceneLoaded.eventsList0(runtimeScene, eventsFunctionContext);


return;
}

gdjs.evtsExt__Gamepads__onFirstSceneLoaded.registeredGdjsCallbacks = [];
gdjs.evtsExt__Gamepads__onFirstSceneLoaded.registeredGdjsCallbacks.push((runtimeScene) => {
    gdjs.evtsExt__Gamepads__onFirstSceneLoaded.func(runtimeScene, runtimeScene);
})
gdjs.registerFirstRuntimeSceneLoadedCallback(gdjs.evtsExt__Gamepads__onFirstSceneLoaded.registeredGdjsCallbacks[gdjs.evtsExt__Gamepads__onFirstSceneLoaded.registeredGdjsCallbacks.length - 1]);
