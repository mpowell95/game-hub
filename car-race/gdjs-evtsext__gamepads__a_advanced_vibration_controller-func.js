
if (typeof gdjs.evtsExt__Gamepads__A_Advanced_Vibration_Controller !== "undefined") {
  gdjs.evtsExt__Gamepads__A_Advanced_Vibration_Controller.registeredGdjsCallbacks.forEach(callback =>
    gdjs._unregisterCallback(callback)
  );
}

gdjs.evtsExt__Gamepads__A_Advanced_Vibration_Controller = {};
gdjs.evtsExt__Gamepads__A_Advanced_Vibration_Controller.idToCallbackMap = new Map();


gdjs.evtsExt__Gamepads__A_Advanced_Vibration_Controller.userFunc0xa53658 = function GDJSInlineCode(runtimeScene, eventsFunctionContext) {
"use strict";
const { clamp } = gdjs.evtTools.common;
const playerId = eventsFunctionContext.getArgument("PlayerId") - 1;
const duration = eventsFunctionContext.getArgument("Duration") || 1;
const strongRumbleMagnitude = clamp(eventsFunctionContext.getArgument("StrongMagnitude"), 0, 1);
const weakRumbleMagnitude = clamp(eventsFunctionContext.getArgument("WeakMagnitude"), 0, 1);
/** @type {Gamepad} */
const gamepad = gdjs._extensionController.getGamepad(playerId);
if (!gamepad) {
    // The gamepad is not connected.
    return;
}
//Vibration work only on game in browser.
if (gamepad.vibrationActuator) {
  gamepad.vibrationActuator.playEffect("dual-rumble", {
    startDelay: 0,
    duration: duration * 1000,
    weakMagnitude: weakRumbleMagnitude,
    strongMagnitude: strongRumbleMagnitude
  });
}
const player = gdjs._extensionController.getPlayer(playerId)
player.rumble.duration = duration;
player.rumble.elapsedTime = 0;
player.rumble.weakMagnitude = weakRumbleMagnitude;
player.rumble.strongMagnitude = strongRumbleMagnitude;
};
gdjs.evtsExt__Gamepads__A_Advanced_Vibration_Controller.eventsList0 = function(runtimeScene, eventsFunctionContext) {

{


gdjs.evtsExt__Gamepads__A_Advanced_Vibration_Controller.userFunc0xa53658(runtimeScene, eventsFunctionContext);

}


};

gdjs.evtsExt__Gamepads__A_Advanced_Vibration_Controller.func = function(runtimeScene, PlayerId, Duration, StrongMagnitude, WeakMagnitude, parentEventsFunctionContext) {
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
if (argName === "PlayerId") return PlayerId;
if (argName === "Duration") return Duration;
if (argName === "StrongMagnitude") return StrongMagnitude;
if (argName === "WeakMagnitude") return WeakMagnitude;
    return "";
  },
  getOnceTriggers: function() { return runtimeScene.getOnceTriggers(); }
};


gdjs.evtsExt__Gamepads__A_Advanced_Vibration_Controller.eventsList0(runtimeScene, eventsFunctionContext);


return;
}

gdjs.evtsExt__Gamepads__A_Advanced_Vibration_Controller.registeredGdjsCallbacks = [];