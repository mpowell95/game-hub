
if (typeof gdjs.evtsExt__Gamepads__A_Vibrate_controller !== "undefined") {
  gdjs.evtsExt__Gamepads__A_Vibrate_controller.registeredGdjsCallbacks.forEach(callback =>
    gdjs._unregisterCallback(callback)
  );
}

gdjs.evtsExt__Gamepads__A_Vibrate_controller = {};
gdjs.evtsExt__Gamepads__A_Vibrate_controller.idToCallbackMap = new Map();


gdjs.evtsExt__Gamepads__A_Vibrate_controller.userFunc0xb17990 = function GDJSInlineCode(runtimeScene, eventsFunctionContext) {
"use strict";
const playerId = eventsFunctionContext.getArgument("PlayerId") - 1;
const duration = eventsFunctionContext.getArgument("Duration") || 1;
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
    weakMagnitude: 1.0,
    strongMagnitude: 1.0
  });
}
};
gdjs.evtsExt__Gamepads__A_Vibrate_controller.eventsList0 = function(runtimeScene, eventsFunctionContext) {

{


gdjs.evtsExt__Gamepads__A_Vibrate_controller.userFunc0xb17990(runtimeScene, eventsFunctionContext);

}


};

gdjs.evtsExt__Gamepads__A_Vibrate_controller.func = function(runtimeScene, PlayerId, Duration, parentEventsFunctionContext) {
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
    return "";
  },
  getOnceTriggers: function() { return runtimeScene.getOnceTriggers(); }
};


gdjs.evtsExt__Gamepads__A_Vibrate_controller.eventsList0(runtimeScene, eventsFunctionContext);


return;
}

gdjs.evtsExt__Gamepads__A_Vibrate_controller.registeredGdjsCallbacks = [];