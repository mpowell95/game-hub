
if (typeof gdjs.evtsExt__Gamepads__GamepadType !== "undefined") {
  gdjs.evtsExt__Gamepads__GamepadType.registeredGdjsCallbacks.forEach(callback =>
    gdjs._unregisterCallback(callback)
  );
}

gdjs.evtsExt__Gamepads__GamepadType = {};
gdjs.evtsExt__Gamepads__GamepadType.idToCallbackMap = new Map();


gdjs.evtsExt__Gamepads__GamepadType.userFunc0xa9ef38 = function GDJSInlineCode(runtimeScene, eventsFunctionContext) {
"use strict";
const playerId = eventsFunctionContext.getArgument("PlayerId") - 1;
/** @type {Gamepad} */
const gamepad = gdjs._extensionController.getGamepad(playerId);
if (!gamepad) {
    // The gamepad is not connected.
    return;
}
eventsFunctionContext.returnValue = (gamepad && gamepad.id) ? gamepad.id : "No information for player " + (playerId + 1)

};
gdjs.evtsExt__Gamepads__GamepadType.eventsList0 = function(runtimeScene, eventsFunctionContext) {

{


gdjs.evtsExt__Gamepads__GamepadType.userFunc0xa9ef38(runtimeScene, eventsFunctionContext);

}


};

gdjs.evtsExt__Gamepads__GamepadType.func = function(runtimeScene, PlayerId, parentEventsFunctionContext) {
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
    return "";
  },
  getOnceTriggers: function() { return runtimeScene.getOnceTriggers(); }
};


gdjs.evtsExt__Gamepads__GamepadType.eventsList0(runtimeScene, eventsFunctionContext);


return "" + eventsFunctionContext.returnValue;
}

gdjs.evtsExt__Gamepads__GamepadType.registeredGdjsCallbacks = [];