
if (typeof gdjs.evtsExt__Gamepads__StickAngle !== "undefined") {
  gdjs.evtsExt__Gamepads__StickAngle.registeredGdjsCallbacks.forEach(callback =>
    gdjs._unregisterCallback(callback)
  );
}

gdjs.evtsExt__Gamepads__StickAngle = {};
gdjs.evtsExt__Gamepads__StickAngle.idToCallbackMap = new Map();


gdjs.evtsExt__Gamepads__StickAngle.userFunc0xafaa98 = function GDJSInlineCode(runtimeScene, eventsFunctionContext) {
"use strict";
const { getNormalizedAxisValue } = gdjs._extensionController;

const playerId = eventsFunctionContext.getArgument("PlayerId") - 1;
const stick = eventsFunctionContext.getArgument("Stick").toUpperCase();

if (stick !== "LEFT" && stick !== "RIGHT") {
    console.error('Parameter stick is not valid in expression: "Value of a stick rotation"');
    return;
}
/** @type {Gamepad} */
const gamepad = gdjs._extensionController.getGamepad(playerId);
if (!gamepad) {
    // The gamepad is not connected.
    return;
}
const axisValueX = stick === 'RIGHT' ? gamepad.axes[2] : gamepad.axes[0];
const axisValueY = stick === 'RIGHT' ? gamepad.axes[3] : gamepad.axes[1];

eventsFunctionContext.returnValue = gdjs._extensionController.axisToAngle(
    getNormalizedAxisValue(axisValueX, playerId),
    getNormalizedAxisValue(axisValueY, playerId));
};
gdjs.evtsExt__Gamepads__StickAngle.eventsList0 = function(runtimeScene, eventsFunctionContext) {

{


gdjs.evtsExt__Gamepads__StickAngle.userFunc0xafaa98(runtimeScene, eventsFunctionContext);

}


};

gdjs.evtsExt__Gamepads__StickAngle.func = function(runtimeScene, PlayerId, Stick, parentEventsFunctionContext) {
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
if (argName === "Stick") return Stick;
    return "";
  },
  getOnceTriggers: function() { return runtimeScene.getOnceTriggers(); }
};


gdjs.evtsExt__Gamepads__StickAngle.eventsList0(runtimeScene, eventsFunctionContext);


return Number(eventsFunctionContext.returnValue) || 0;
}

gdjs.evtsExt__Gamepads__StickAngle.registeredGdjsCallbacks = [];