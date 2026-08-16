
if (typeof gdjs.evtsExt__Gamepads__onSceneLoaded !== "undefined") {
  gdjs.evtsExt__Gamepads__onSceneLoaded.registeredGdjsCallbacks.forEach(callback =>
    gdjs._unregisterCallback(callback)
  );
}

gdjs.evtsExt__Gamepads__onSceneLoaded = {};
gdjs.evtsExt__Gamepads__onSceneLoaded.idToCallbackMap = new Map();


gdjs.evtsExt__Gamepads__onSceneLoaded.userFunc0xb92158 = function GDJSInlineCode(runtimeScene, eventsFunctionContext) {
"use strict";
// Async tasks are run before everything.
// This is a hack to make sure that button states are updated
// before mapping behavior events.
runtimeScene.getAsyncTasksManager().addTask(gdjs._extensionController.frameBeginningTask);
};
gdjs.evtsExt__Gamepads__onSceneLoaded.eventsList0 = function(runtimeScene, eventsFunctionContext) {

{


gdjs.evtsExt__Gamepads__onSceneLoaded.userFunc0xb92158(runtimeScene, eventsFunctionContext);

}


};

gdjs.evtsExt__Gamepads__onSceneLoaded.func = function(runtimeScene, parentEventsFunctionContext) {
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


gdjs.evtsExt__Gamepads__onSceneLoaded.eventsList0(runtimeScene, eventsFunctionContext);


return;
}

gdjs.evtsExt__Gamepads__onSceneLoaded.registeredGdjsCallbacks = [];
gdjs.evtsExt__Gamepads__onSceneLoaded.registeredGdjsCallbacks.push((runtimeScene) => {
    gdjs.evtsExt__Gamepads__onSceneLoaded.func(runtimeScene, runtimeScene);
})
gdjs.registerRuntimeSceneLoadedCallback(gdjs.evtsExt__Gamepads__onSceneLoaded.registeredGdjsCallbacks[gdjs.evtsExt__Gamepads__onSceneLoaded.registeredGdjsCallbacks.length - 1]);
