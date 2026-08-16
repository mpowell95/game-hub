
if (typeof gdjs.evtsExt__Gamepads__TriggerPressure !== "undefined") {
  gdjs.evtsExt__Gamepads__TriggerPressure.registeredGdjsCallbacks.forEach(callback =>
    gdjs._unregisterCallback(callback)
  );
}

gdjs.evtsExt__Gamepads__TriggerPressure = {};
gdjs.evtsExt__Gamepads__TriggerPressure.idToCallbackMap = new Map();


gdjs.evtsExt__Gamepads__TriggerPressure.userFunc0xc095a8 = function GDJSInlineCode(runtimeScene, eventsFunctionContext) {
"use strict";

const playerId = eventsFunctionContext.getArgument("PlayerId") - 1;
const trigger = eventsFunctionContext.getArgument("Trigger").toUpperCase();

if (trigger != "LT" && trigger != "RT" && trigger != "L2" && trigger != "R2") {
    console.error('Parameter trigger is not valid in expression: "Pressure on a gamepad trigger"');
    return;
}
/** @type {Gamepad} */
const gamepad = gdjs._extensionController.getGamepad(playerId);
if (!gamepad) {
    // The gamepad is not connected.
    return;
}
switch (trigger) {
    case 'LT':
    case 'L2':
        eventsFunctionContext.returnValue = gamepad.buttons[6].value;
        break;

    case 'RT':
    case 'R2':
        eventsFunctionContext.returnValue = gamepad.buttons[7].value;
        break;

    default:
        eventsFunctionContext.returnValue = -1;
        break;
}
};
gdjs.evtsExt__Gamepads__TriggerPressure.eventsList0 = function(runtimeScene, eventsFunctionContext) {

{


gdjs.evtsExt__Gamepads__TriggerPressure.userFunc0xc095a8(runtimeScene, eventsFunctionContext);

}


};

gdjs.evtsExt__Gamepads__TriggerPressure.func = function(runtimeScene, PlayerId, Trigger, parentEventsFunctionContext) {
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
if (argName === "Trigger") return Trigger;
    return "";
  },
  getOnceTriggers: function() { return runtimeScene.getOnceTriggers(); }
};


gdjs.evtsExt__Gamepads__TriggerPressure.eventsList0(runtimeScene, eventsFunctionContext);


return Number(eventsFunctionContext.returnValue) || 0;
}

gdjs.evtsExt__Gamepads__TriggerPressure.registeredGdjsCallbacks = [];