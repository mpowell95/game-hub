
if (typeof gdjs.evtsExt__Gamepads__onScenePostEvents !== "undefined") {
  gdjs.evtsExt__Gamepads__onScenePostEvents.registeredGdjsCallbacks.forEach(callback =>
    gdjs._unregisterCallback(callback)
  );
}

gdjs.evtsExt__Gamepads__onScenePostEvents = {};
gdjs.evtsExt__Gamepads__onScenePostEvents.idToCallbackMap = new Map();


gdjs.evtsExt__Gamepads__onScenePostEvents.userFunc0xb92158 = function GDJSInlineCode(runtimeScene, eventsFunctionContext) {
"use strict";
gdjs._extensionController.onScenePostEvents();

};
gdjs.evtsExt__Gamepads__onScenePostEvents.eventsList0 = function(runtimeScene, eventsFunctionContext) {

{


gdjs.evtsExt__Gamepads__onScenePostEvents.userFunc0xb92158(runtimeScene, eventsFunctionContext);

}


};

gdjs.evtsExt__Gamepads__onScenePostEvents.func = function(runtimeScene, parentEventsFunctionContext) {
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


gdjs.evtsExt__Gamepads__onScenePostEvents.eventsList0(runtimeScene, eventsFunctionContext);


return;
}

gdjs.evtsExt__Gamepads__onScenePostEvents.registeredGdjsCallbacks = [];
gdjs.evtsExt__Gamepads__onScenePostEvents.registeredGdjsCallbacks.push((runtimeScene) => {
    gdjs.evtsExt__Gamepads__onScenePostEvents.func(runtimeScene, runtimeScene);
})
gdjs.registerRuntimeScenePostEventsCallback(gdjs.evtsExt__Gamepads__onScenePostEvents.registeredGdjsCallbacks[gdjs.evtsExt__Gamepads__onScenePostEvents.registeredGdjsCallbacks.length - 1]);
