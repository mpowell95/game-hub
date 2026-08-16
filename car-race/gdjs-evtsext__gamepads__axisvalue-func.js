
if (typeof gdjs.evtsExt__Gamepads__AxisValue !== "undefined") {
  gdjs.evtsExt__Gamepads__AxisValue.registeredGdjsCallbacks.forEach(callback =>
    gdjs._unregisterCallback(callback)
  );
}

gdjs.evtsExt__Gamepads__AxisValue = {};
gdjs.evtsExt__Gamepads__AxisValue.idToCallbackMap = new Map();


gdjs.evtsExt__Gamepads__AxisValue.userFunc0xa576d8 = function GDJSInlineCode(runtimeScene, eventsFunctionContext) {
"use strict";

const playerId = eventsFunctionContext.getArgument("PlayerId") - 1;
const stick = eventsFunctionContext.getArgument("stick").toUpperCase();
const direction = eventsFunctionContext.getArgument("direction").toUpperCase();

if (stick != "LEFT" && stick != "RIGHT") {
    console.error('Parameter stick is not valid in expression: "Value of a gamepad axis"');
    return;
}
if (direction != "UP" && direction != "DOWN" && direction != "LEFT" && direction != "RIGHT" && direction != "HORIZONTAL" && direction != "VERTICAL") {
    console.error('Parameter direction is not valid in expression: "Value of a gamepad axis"');
    return;
}
/** @type {Gamepad} */
const gamepad = gdjs._extensionController.getGamepad(playerId);
if (!gamepad) {
    // The gamepad is not connected.
    return;
}
let parameterError = false;
switch (stick) {
    case 'LEFT':
        switch (direction) {
            case 'LEFT':
                if (gdjs._extensionController.getNormalizedAxisValue(gamepad.axes[0], playerId) < 0) {
                    eventsFunctionContext.returnValue = -gdjs._extensionController.getNormalizedAxisValue(gamepad.axes[0], playerId);
                }
                break;

            case 'RIGHT':
                if (gdjs._extensionController.getNormalizedAxisValue(gamepad.axes[0], playerId) > 0) {
                    eventsFunctionContext.returnValue = gdjs._extensionController.getNormalizedAxisValue(gamepad.axes[0], playerId);
                }
                break;

            case 'UP':
                if (gdjs._extensionController.getNormalizedAxisValue(gamepad.axes[1], playerId) < 0) {
                    eventsFunctionContext.returnValue = -gdjs._extensionController.getNormalizedAxisValue(gamepad.axes[1], playerId);
                }
                break;

            case 'DOWN':
                if (gdjs._extensionController.getNormalizedAxisValue(gamepad.axes[1], playerId) > 0) {
                    eventsFunctionContext.returnValue = gdjs._extensionController.getNormalizedAxisValue(gamepad.axes[1], playerId);
                }
                break;

            case "HORIZONTAL":
                eventsFunctionContext.returnValue = gdjs._extensionController.getNormalizedAxisValue(gamepad.axes[0], playerId);
                break;

            case "VERTICAL":
                eventsFunctionContext.returnValue = gdjs._extensionController.getNormalizedAxisValue(gamepad.axes[1], playerId);
                break;

            default:
                break;
        }
        break;

    case 'RIGHT':
        switch (direction) {
            case 'LEFT':
                if (gdjs._extensionController.getNormalizedAxisValue(gamepad.axes[2], playerId) < 0) {
                    eventsFunctionContext.returnValue = -gdjs._extensionController.getNormalizedAxisValue(gamepad.axes[2], playerId);
                }
                break;

            case 'RIGHT':
                if (gdjs._extensionController.getNormalizedAxisValue(gamepad.axes[2], playerId) > 0) {
                    eventsFunctionContext.returnValue = gdjs._extensionController.getNormalizedAxisValue(gamepad.axes[2], playerId);
                }
                break;

            case 'UP':
                if (gdjs._extensionController.getNormalizedAxisValue(gamepad.axes[3], playerId) < 0) {
                    eventsFunctionContext.returnValue = -gdjs._extensionController.getNormalizedAxisValue(gamepad.axes[3], playerId);
                }
                break;

            case 'DOWN':
                if (gdjs._extensionController.getNormalizedAxisValue(gamepad.axes[3], playerId) > 0) {
                    eventsFunctionContext.returnValue = gdjs._extensionController.getNormalizedAxisValue(gamepad.axes[3], playerId);
                }
                break;

            case "HORIZONTAL":
                eventsFunctionContext.returnValue = gdjs._extensionController.getNormalizedAxisValue(gamepad.axes[2], playerId);
                break;

            case "VERTICAL":
                eventsFunctionContext.returnValue = gdjs._extensionController.getNormalizedAxisValue(gamepad.axes[3], playerId);
                break;

            default:
                break;
        }
        break;

    default:
        break;
}

};
gdjs.evtsExt__Gamepads__AxisValue.eventsList0 = function(runtimeScene, eventsFunctionContext) {

{


gdjs.evtsExt__Gamepads__AxisValue.userFunc0xa576d8(runtimeScene, eventsFunctionContext);

}


};

gdjs.evtsExt__Gamepads__AxisValue.func = function(runtimeScene, PlayerId, stick, direction, parentEventsFunctionContext) {
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
if (argName === "stick") return stick;
if (argName === "direction") return direction;
    return "";
  },
  getOnceTriggers: function() { return runtimeScene.getOnceTriggers(); }
};


gdjs.evtsExt__Gamepads__AxisValue.eventsList0(runtimeScene, eventsFunctionContext);


return Number(eventsFunctionContext.returnValue) || 0;
}

gdjs.evtsExt__Gamepads__AxisValue.registeredGdjsCallbacks = [];