
if (typeof gdjs.evtsExt__Gamepads__IsButtonJustPressed !== "undefined") {
  gdjs.evtsExt__Gamepads__IsButtonJustPressed.registeredGdjsCallbacks.forEach(callback =>
    gdjs._unregisterCallback(callback)
  );
}

gdjs.evtsExt__Gamepads__IsButtonJustPressed = {};
gdjs.evtsExt__Gamepads__IsButtonJustPressed.idToCallbackMap = new Map();


gdjs.evtsExt__Gamepads__IsButtonJustPressed.userFunc0xcba590 = function GDJSInlineCode(runtimeScene, eventsFunctionContext) {
"use strict";

const playerId = eventsFunctionContext.getArgument("PlayerId") - 1;
const button = eventsFunctionContext.getArgument("Button").toUpperCase();

let buttonId = gdjs._extensionController.getButtonId(button);
if (buttonId === null) {
    return;
}
const player = gdjs._extensionController.getPlayer(playerId)
eventsFunctionContext.returnValue = player.isButtonJustPressed(buttonId);
};
gdjs.evtsExt__Gamepads__IsButtonJustPressed.eventsList0 = function(runtimeScene, eventsFunctionContext) {

{


gdjs.evtsExt__Gamepads__IsButtonJustPressed.userFunc0xcba590(runtimeScene, eventsFunctionContext);

}


};

gdjs.evtsExt__Gamepads__IsButtonJustPressed.func = function(runtimeScene, PlayerId, Button, parentEventsFunctionContext) {
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
if (argName === "Button") return Button;
    return "";
  },
  getOnceTriggers: function() { return runtimeScene.getOnceTriggers(); }
};


gdjs.evtsExt__Gamepads__IsButtonJustPressed.eventsList0(runtimeScene, eventsFunctionContext);


return !!eventsFunctionContext.returnValue;
}

gdjs.evtsExt__Gamepads__IsButtonJustPressed.registeredGdjsCallbacks = [];