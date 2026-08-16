
gdjs.evtsExt__Level__RoadTileBehavior = gdjs.evtsExt__Level__RoadTileBehavior || {};

/**
 * Behavior generated from 
 */
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior = class RoadTileBehavior extends gdjs.RuntimeBehavior {
  constructor(instanceContainer, behaviorData, owner) {
    super(instanceContainer, behaviorData, owner);
    this._runtimeScene = instanceContainer;

    this._onceTriggers = new gdjs.OnceTriggers();
    this._behaviorData = {};
    this._sharedData = gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.getSharedData(
      instanceContainer,
      behaviorData.name
    );
    
    this._behaviorData.Path = behaviorData.Path !== undefined ? behaviorData.Path : "";
    this._behaviorData.StartX = behaviorData.StartX !== undefined ? behaviorData.StartX : Number("0") || 0;
    this._behaviorData.StartY = behaviorData.StartY !== undefined ? behaviorData.StartY : Number("0") || 0;
    this._behaviorData.RotatedStartX = Number("") || 0;
    this._behaviorData.RotatedStartY = Number("") || 0;
  }

  // Hot-reload:
  applyBehaviorOverriding(behaviorOverriding) {
    
    if (behaviorOverriding.Path !== undefined)
      this._behaviorData.Path = behaviorOverriding.Path;
    if (behaviorOverriding.StartX !== undefined)
      this._behaviorData.StartX = behaviorOverriding.StartX;
    if (behaviorOverriding.StartY !== undefined)
      this._behaviorData.StartY = behaviorOverriding.StartY;
    if (behaviorOverriding.RotatedStartX !== undefined)
      this._behaviorData.RotatedStartX = behaviorOverriding.RotatedStartX;
    if (behaviorOverriding.RotatedStartY !== undefined)
      this._behaviorData.RotatedStartY = behaviorOverriding.RotatedStartY;

    return true;
  }

  // Network sync:
  getNetworkSyncData(syncOptions) {
    return {
      ...super.getNetworkSyncData(syncOptions),
      props: {
        
    Path: this._behaviorData.Path,
    StartX: this._behaviorData.StartX,
    StartY: this._behaviorData.StartY,
    RotatedStartX: this._behaviorData.RotatedStartX,
    RotatedStartY: this._behaviorData.RotatedStartY,
      }
    };
  }
  updateFromNetworkSyncData(networkSyncData, options) {
    super.updateFromNetworkSyncData(networkSyncData, options);
    
    if (networkSyncData.props.Path !== undefined)
      this._behaviorData.Path = networkSyncData.props.Path;
    if (networkSyncData.props.StartX !== undefined)
      this._behaviorData.StartX = networkSyncData.props.StartX;
    if (networkSyncData.props.StartY !== undefined)
      this._behaviorData.StartY = networkSyncData.props.StartY;
    if (networkSyncData.props.RotatedStartX !== undefined)
      this._behaviorData.RotatedStartX = networkSyncData.props.RotatedStartX;
    if (networkSyncData.props.RotatedStartY !== undefined)
      this._behaviorData.RotatedStartY = networkSyncData.props.RotatedStartY;
  }

  // Properties:
  
  _getPath() {
    return this._behaviorData.Path !== undefined ? this._behaviorData.Path : "";
  }
  _setPath(newValue) {
    this._behaviorData.Path = newValue;
  }
  _getStartX() {
    return this._behaviorData.StartX !== undefined ? this._behaviorData.StartX : Number("0") || 0;
  }
  _setStartX(newValue) {
    this._behaviorData.StartX = newValue;
  }
  _getStartY() {
    return this._behaviorData.StartY !== undefined ? this._behaviorData.StartY : Number("0") || 0;
  }
  _setStartY(newValue) {
    this._behaviorData.StartY = newValue;
  }
  _getRotatedStartX() {
    return this._behaviorData.RotatedStartX !== undefined ? this._behaviorData.RotatedStartX : Number("") || 0;
  }
  _setRotatedStartX(newValue) {
    this._behaviorData.RotatedStartX = newValue;
  }
  _getRotatedStartY() {
    return this._behaviorData.RotatedStartY !== undefined ? this._behaviorData.RotatedStartY : Number("") || 0;
  }
  _setRotatedStartY(newValue) {
    this._behaviorData.RotatedStartY = newValue;
  }
}

/**
 * Shared data generated from 
 */
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.SharedData = class RoadTileBehaviorSharedData {
  constructor(sharedData) {
    
  }
  
  // Shared properties:
  
}

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.getSharedData = function(instanceContainer, behaviorName) {
  if (!instanceContainer._Level_RoadTileBehaviorSharedData) {
    const initialData = instanceContainer.getInitialSharedDataForBehavior(
      behaviorName
    );
    instanceContainer._Level_RoadTileBehaviorSharedData = new gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.SharedData(
      initialData
    );
  }
  return instanceContainer._Level_RoadTileBehaviorSharedData;
}

// Methods:
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext = {};
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.idToCallbackMap = new Map();
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1= [];
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2= [];
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects3= [];


gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.eventsList0 = function(runtimeScene, eventsFunctionContext) {

{

gdjs.copyArray(gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1, gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2);


let isConditionTrue_0 = false;
isConditionTrue_0 = false;
isConditionTrue_0 = !(gdjs.evtsExt__CurvedMovement__PathExists.func(runtimeScene, (( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2.length === 0 ) ? "" :gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")).PathName(eventsFunctionContext)), eventsFunctionContext));
if (isConditionTrue_0) {
/* Reuse gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2 */
{gdjs.evtsExt__CurvedMovement__CreatePathFromSvg.func(runtimeScene, (( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2.length === 0 ) ? "" :gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")).PathName(eventsFunctionContext)), (( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2.length === 0 ) ? "" :gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"))._getPath()), eventsFunctionContext);
}
{gdjs.evtsExt__CurvedMovement__RotatePath.func(runtimeScene, (( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2.length === 0 ) ? "" :gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")).PathName(eventsFunctionContext)), (( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2.length === 0 ) ? 0 :gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2[0].getAngle()), eventsFunctionContext);
}
}

}


{

gdjs.copyArray(gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1, gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2);


let isConditionTrue_0 = false;
isConditionTrue_0 = false;
isConditionTrue_0 = !(gdjs.evtsExt__CurvedMovement__PathExists.func(runtimeScene, (( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2.length === 0 ) ? "" :gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")).InvertedPathName(eventsFunctionContext)), eventsFunctionContext));
if (isConditionTrue_0) {
/* Reuse gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2 */
{gdjs.evtsExt__CurvedMovement__CreatePathFromSvg.func(runtimeScene, (( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2.length === 0 ) ? "" :gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")).InvertedPathName(eventsFunctionContext)), (( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2.length === 0 ) ? "" :gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"))._getPath()), eventsFunctionContext);
}
{gdjs.evtsExt__CurvedMovement__RotatePath.func(runtimeScene, (( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2.length === 0 ) ? "" :gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")).InvertedPathName(eventsFunctionContext)), (( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2.length === 0 ) ? 0 :gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2[0].getAngle()), eventsFunctionContext);
}
{gdjs.evtsExt__CurvedMovement__InvertPath.func(runtimeScene, (( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2.length === 0 ) ? "" :gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")).InvertedPathName(eventsFunctionContext)), eventsFunctionContext);
}
}

}


};gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.eventsList1 = function(runtimeScene, eventsFunctionContext) {

{

gdjs.copyArray(eventsFunctionContext.getObjects("Object"), gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1);

let isConditionTrue_0 = false;
isConditionTrue_0 = false;
for (var i = 0, k = 0, l = gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1.length;i<l;++i) {
    if ( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1[i].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"))._getRotatedStartX() == 0 ) {
        isConditionTrue_0 = true;
        gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1[k] = gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1[i];
        ++k;
    }
}
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1.length = k;
if (isConditionTrue_0) {
isConditionTrue_0 = false;
for (var i = 0, k = 0, l = gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1.length;i<l;++i) {
    if ( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1[i].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"))._getRotatedStartY() == 0 ) {
        isConditionTrue_0 = true;
        gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1[k] = gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1[i];
        ++k;
    }
}
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1.length = k;
}
if (isConditionTrue_0) {
/* Reuse gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1 */
{for(var i = 0, len = gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1.length ;i < len;++i) {
    gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1[i].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"))._setRotatedStartX(Math.round(Math.cos(gdjs.toRad((gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1[i].getAngle()))) * eventsFunctionContext.getObjects("Object")[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"))._getStartX() - Math.sin(gdjs.toRad((gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1[i].getAngle()))) * eventsFunctionContext.getObjects("Object")[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"))._getStartY()));
}
}
{for(var i = 0, len = gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1.length ;i < len;++i) {
    gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1[i].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"))._setRotatedStartY(Math.round(Math.sin(gdjs.toRad((gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1[i].getAngle()))) * eventsFunctionContext.getObjects("Object")[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"))._getStartX() + Math.cos(gdjs.toRad((gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1[i].getAngle()))) * eventsFunctionContext.getObjects("Object")[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"))._getStartY()));
}
}

{ //Subevents
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.eventsList0(runtimeScene, eventsFunctionContext);} //End of subevents
}

}


};

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathes = function(parentEventsFunctionContext) {

var that = this;
var runtimeScene = this._runtimeScene;
let scopeInstanceContainer = null;
var thisObjectList = [this.owner];
var Object = Hashtable.newFrom({Object: thisObjectList});
var Behavior = this.name;
var eventsFunctionContext = {
  _objectsMap: {
"Object": Object
},
  _objectArraysMap: {
"Object": thisObjectList
},
  _behaviorNamesMap: {
"Behavior": Behavior
},
  globalVariablesForExtension: runtimeScene.getGame().getVariablesForExtension("Level"),
  sceneVariablesForExtension: runtimeScene.getScene().getVariablesForExtension("Level"),
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
  getOnceTriggers: function() { return that._onceTriggers; }
};

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1.length = 0;
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2.length = 0;
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects3.length = 0;

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.eventsList1(runtimeScene, eventsFunctionContext);
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects1.length = 0;
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects2.length = 0;
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InitializePathesContext.GDObjectObjects3.length = 0;


return;
}
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.PathNameContext = {};
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.PathNameContext.idToCallbackMap = new Map();
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.PathNameContext.GDObjectObjects1= [];
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.PathNameContext.GDObjectObjects2= [];


gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.PathNameContext.eventsList0 = function(runtimeScene, eventsFunctionContext) {

{


let isConditionTrue_0 = false;
{
gdjs.copyArray(eventsFunctionContext.getObjects("Object"), gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.PathNameContext.GDObjectObjects1);
{eventsFunctionContext.returnValue = (( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.PathNameContext.GDObjectObjects1.length === 0 ) ? "" :gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.PathNameContext.GDObjectObjects1[0].getName()) + " " + gdjs.evtTools.common.toString((( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.PathNameContext.GDObjectObjects1.length === 0 ) ? 0 :gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.PathNameContext.GDObjectObjects1[0].getAngle()));}
}

}


};

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.PathName = function(parentEventsFunctionContext) {

var that = this;
var runtimeScene = this._runtimeScene;
let scopeInstanceContainer = null;
var thisObjectList = [this.owner];
var Object = Hashtable.newFrom({Object: thisObjectList});
var Behavior = this.name;
var eventsFunctionContext = {
  _objectsMap: {
"Object": Object
},
  _objectArraysMap: {
"Object": thisObjectList
},
  _behaviorNamesMap: {
"Behavior": Behavior
},
  globalVariablesForExtension: runtimeScene.getGame().getVariablesForExtension("Level"),
  sceneVariablesForExtension: runtimeScene.getScene().getVariablesForExtension("Level"),
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
  getOnceTriggers: function() { return that._onceTriggers; }
};

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.PathNameContext.GDObjectObjects1.length = 0;
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.PathNameContext.GDObjectObjects2.length = 0;

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.PathNameContext.eventsList0(runtimeScene, eventsFunctionContext);
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.PathNameContext.GDObjectObjects1.length = 0;
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.PathNameContext.GDObjectObjects2.length = 0;


return "" + eventsFunctionContext.returnValue;
}
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InvertedPathNameContext = {};
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InvertedPathNameContext.idToCallbackMap = new Map();
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InvertedPathNameContext.GDObjectObjects1= [];
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InvertedPathNameContext.GDObjectObjects2= [];


gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InvertedPathNameContext.eventsList0 = function(runtimeScene, eventsFunctionContext) {

{


let isConditionTrue_0 = false;
{
gdjs.copyArray(eventsFunctionContext.getObjects("Object"), gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InvertedPathNameContext.GDObjectObjects1);
{eventsFunctionContext.returnValue = (( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InvertedPathNameContext.GDObjectObjects1.length === 0 ) ? "" :gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InvertedPathNameContext.GDObjectObjects1[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")).PathName(eventsFunctionContext)) + " i";}
}

}


};

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InvertedPathName = function(parentEventsFunctionContext) {

var that = this;
var runtimeScene = this._runtimeScene;
let scopeInstanceContainer = null;
var thisObjectList = [this.owner];
var Object = Hashtable.newFrom({Object: thisObjectList});
var Behavior = this.name;
var eventsFunctionContext = {
  _objectsMap: {
"Object": Object
},
  _objectArraysMap: {
"Object": thisObjectList
},
  _behaviorNamesMap: {
"Behavior": Behavior
},
  globalVariablesForExtension: runtimeScene.getGame().getVariablesForExtension("Level"),
  sceneVariablesForExtension: runtimeScene.getScene().getVariablesForExtension("Level"),
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
  getOnceTriggers: function() { return that._onceTriggers; }
};

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InvertedPathNameContext.GDObjectObjects1.length = 0;
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InvertedPathNameContext.GDObjectObjects2.length = 0;

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InvertedPathNameContext.eventsList0(runtimeScene, eventsFunctionContext);
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InvertedPathNameContext.GDObjectObjects1.length = 0;
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.InvertedPathNameContext.GDObjectObjects2.length = 0;


return "" + eventsFunctionContext.returnValue;
}
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartXContext = {};
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartXContext.idToCallbackMap = new Map();
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartXContext.GDObjectObjects1= [];
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartXContext.GDObjectObjects2= [];


gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartXContext.eventsList0 = function(runtimeScene, eventsFunctionContext) {

{


let isConditionTrue_0 = false;
{
gdjs.copyArray(eventsFunctionContext.getObjects("Object"), gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartXContext.GDObjectObjects1);
{for(var i = 0, len = gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartXContext.GDObjectObjects1.length ;i < len;++i) {
    gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartXContext.GDObjectObjects1[i].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")).InitializePathes(eventsFunctionContext);
}
}
{eventsFunctionContext.returnValue = (( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartXContext.GDObjectObjects1.length === 0 ) ? 0 :gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartXContext.GDObjectObjects1[0].getCenterXInScene()) + eventsFunctionContext.getObjects("Object")[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"))._getRotatedStartX();}
}

}


};

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartX = function(parentEventsFunctionContext) {

var that = this;
var runtimeScene = this._runtimeScene;
let scopeInstanceContainer = null;
var thisObjectList = [this.owner];
var Object = Hashtable.newFrom({Object: thisObjectList});
var Behavior = this.name;
var eventsFunctionContext = {
  _objectsMap: {
"Object": Object
},
  _objectArraysMap: {
"Object": thisObjectList
},
  _behaviorNamesMap: {
"Behavior": Behavior
},
  globalVariablesForExtension: runtimeScene.getGame().getVariablesForExtension("Level"),
  sceneVariablesForExtension: runtimeScene.getScene().getVariablesForExtension("Level"),
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
  getOnceTriggers: function() { return that._onceTriggers; }
};

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartXContext.GDObjectObjects1.length = 0;
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartXContext.GDObjectObjects2.length = 0;

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartXContext.eventsList0(runtimeScene, eventsFunctionContext);
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartXContext.GDObjectObjects1.length = 0;
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartXContext.GDObjectObjects2.length = 0;


return Number(eventsFunctionContext.returnValue) || 0;
}
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartYContext = {};
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartYContext.idToCallbackMap = new Map();
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartYContext.GDObjectObjects1= [];
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartYContext.GDObjectObjects2= [];


gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartYContext.eventsList0 = function(runtimeScene, eventsFunctionContext) {

{


let isConditionTrue_0 = false;
{
gdjs.copyArray(eventsFunctionContext.getObjects("Object"), gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartYContext.GDObjectObjects1);
{for(var i = 0, len = gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartYContext.GDObjectObjects1.length ;i < len;++i) {
    gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartYContext.GDObjectObjects1[i].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")).InitializePathes(eventsFunctionContext);
}
}
{eventsFunctionContext.returnValue = (( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartYContext.GDObjectObjects1.length === 0 ) ? 0 :gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartYContext.GDObjectObjects1[0].getCenterYInScene()) + eventsFunctionContext.getObjects("Object")[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior"))._getRotatedStartY();}
}

}


};

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartY = function(parentEventsFunctionContext) {

var that = this;
var runtimeScene = this._runtimeScene;
let scopeInstanceContainer = null;
var thisObjectList = [this.owner];
var Object = Hashtable.newFrom({Object: thisObjectList});
var Behavior = this.name;
var eventsFunctionContext = {
  _objectsMap: {
"Object": Object
},
  _objectArraysMap: {
"Object": thisObjectList
},
  _behaviorNamesMap: {
"Behavior": Behavior
},
  globalVariablesForExtension: runtimeScene.getGame().getVariablesForExtension("Level"),
  sceneVariablesForExtension: runtimeScene.getScene().getVariablesForExtension("Level"),
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
  getOnceTriggers: function() { return that._onceTriggers; }
};

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartYContext.GDObjectObjects1.length = 0;
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartYContext.GDObjectObjects2.length = 0;

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartYContext.eventsList0(runtimeScene, eventsFunctionContext);
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartYContext.GDObjectObjects1.length = 0;
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.StartYContext.GDObjectObjects2.length = 0;


return Number(eventsFunctionContext.returnValue) || 0;
}
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndXContext = {};
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndXContext.idToCallbackMap = new Map();
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndXContext.GDObjectObjects1= [];
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndXContext.GDObjectObjects2= [];


gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndXContext.eventsList0 = function(runtimeScene, eventsFunctionContext) {

{


let isConditionTrue_0 = false;
{
gdjs.copyArray(eventsFunctionContext.getObjects("Object"), gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndXContext.GDObjectObjects1);
{for(var i = 0, len = gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndXContext.GDObjectObjects1.length ;i < len;++i) {
    gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndXContext.GDObjectObjects1[i].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")).InitializePathes(eventsFunctionContext);
}
}
{eventsFunctionContext.returnValue = (( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndXContext.GDObjectObjects1.length === 0 ) ? 0 :gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndXContext.GDObjectObjects1[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")).StartX(eventsFunctionContext)) + gdjs.evtsExt__CurvedMovement__PathEndX.func(runtimeScene, (( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndXContext.GDObjectObjects1.length === 0 ) ? "" :gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndXContext.GDObjectObjects1[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")).PathName(eventsFunctionContext)), eventsFunctionContext);}
}

}


};

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndX = function(parentEventsFunctionContext) {

var that = this;
var runtimeScene = this._runtimeScene;
let scopeInstanceContainer = null;
var thisObjectList = [this.owner];
var Object = Hashtable.newFrom({Object: thisObjectList});
var Behavior = this.name;
var eventsFunctionContext = {
  _objectsMap: {
"Object": Object
},
  _objectArraysMap: {
"Object": thisObjectList
},
  _behaviorNamesMap: {
"Behavior": Behavior
},
  globalVariablesForExtension: runtimeScene.getGame().getVariablesForExtension("Level"),
  sceneVariablesForExtension: runtimeScene.getScene().getVariablesForExtension("Level"),
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
  getOnceTriggers: function() { return that._onceTriggers; }
};

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndXContext.GDObjectObjects1.length = 0;
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndXContext.GDObjectObjects2.length = 0;

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndXContext.eventsList0(runtimeScene, eventsFunctionContext);
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndXContext.GDObjectObjects1.length = 0;
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndXContext.GDObjectObjects2.length = 0;


return Number(eventsFunctionContext.returnValue) || 0;
}
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndYContext = {};
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndYContext.idToCallbackMap = new Map();
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndYContext.GDObjectObjects1= [];
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndYContext.GDObjectObjects2= [];


gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndYContext.eventsList0 = function(runtimeScene, eventsFunctionContext) {

{


let isConditionTrue_0 = false;
{
gdjs.copyArray(eventsFunctionContext.getObjects("Object"), gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndYContext.GDObjectObjects1);
{for(var i = 0, len = gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndYContext.GDObjectObjects1.length ;i < len;++i) {
    gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndYContext.GDObjectObjects1[i].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")).InitializePathes(eventsFunctionContext);
}
}
{eventsFunctionContext.returnValue = (( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndYContext.GDObjectObjects1.length === 0 ) ? 0 :gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndYContext.GDObjectObjects1[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")).StartY(eventsFunctionContext)) + gdjs.evtsExt__CurvedMovement__PathEndY.func(runtimeScene, (( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndYContext.GDObjectObjects1.length === 0 ) ? "" :gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndYContext.GDObjectObjects1[0].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")).PathName(eventsFunctionContext)), eventsFunctionContext);}
}

}


};

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndY = function(parentEventsFunctionContext) {

var that = this;
var runtimeScene = this._runtimeScene;
let scopeInstanceContainer = null;
var thisObjectList = [this.owner];
var Object = Hashtable.newFrom({Object: thisObjectList});
var Behavior = this.name;
var eventsFunctionContext = {
  _objectsMap: {
"Object": Object
},
  _objectArraysMap: {
"Object": thisObjectList
},
  _behaviorNamesMap: {
"Behavior": Behavior
},
  globalVariablesForExtension: runtimeScene.getGame().getVariablesForExtension("Level"),
  sceneVariablesForExtension: runtimeScene.getScene().getVariablesForExtension("Level"),
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
  getOnceTriggers: function() { return that._onceTriggers; }
};

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndYContext.GDObjectObjects1.length = 0;
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndYContext.GDObjectObjects2.length = 0;

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndYContext.eventsList0(runtimeScene, eventsFunctionContext);
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndYContext.GDObjectObjects1.length = 0;
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.EndYContext.GDObjectObjects2.length = 0;


return Number(eventsFunctionContext.returnValue) || 0;
}
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext = {};
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext.idToCallbackMap = new Map();
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext.GDObjectObjects1= [];
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext.GDObjectObjects2= [];


gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext.eventsList0 = function(runtimeScene, eventsFunctionContext) {

{

gdjs.copyArray(eventsFunctionContext.getObjects("Object"), gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext.GDObjectObjects1);

let isConditionTrue_0 = false;
isConditionTrue_0 = false;
for (var i = 0, k = 0, l = gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext.GDObjectObjects1.length;i<l;++i) {
    if ( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext.GDObjectObjects1[i].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")).StartX(eventsFunctionContext) == eventsFunctionContext.getArgument("X") ) {
        isConditionTrue_0 = true;
        gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext.GDObjectObjects1[k] = gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext.GDObjectObjects1[i];
        ++k;
    }
}
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext.GDObjectObjects1.length = k;
if (isConditionTrue_0) {
isConditionTrue_0 = false;
for (var i = 0, k = 0, l = gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext.GDObjectObjects1.length;i<l;++i) {
    if ( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext.GDObjectObjects1[i].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")).StartY(eventsFunctionContext) == eventsFunctionContext.getArgument("Y") ) {
        isConditionTrue_0 = true;
        gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext.GDObjectObjects1[k] = gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext.GDObjectObjects1[i];
        ++k;
    }
}
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext.GDObjectObjects1.length = k;
}
if (isConditionTrue_0) {
{eventsFunctionContext.returnValue = true;}
}

}


};

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPosition = function(X, Y, parentEventsFunctionContext) {

var that = this;
var runtimeScene = this._runtimeScene;
let scopeInstanceContainer = null;
var thisObjectList = [this.owner];
var Object = Hashtable.newFrom({Object: thisObjectList});
var Behavior = this.name;
var eventsFunctionContext = {
  _objectsMap: {
"Object": Object
},
  _objectArraysMap: {
"Object": thisObjectList
},
  _behaviorNamesMap: {
"Behavior": Behavior
},
  globalVariablesForExtension: runtimeScene.getGame().getVariablesForExtension("Level"),
  sceneVariablesForExtension: runtimeScene.getScene().getVariablesForExtension("Level"),
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
if (argName === "X") return X;
if (argName === "Y") return Y;
    return "";
  },
  getOnceTriggers: function() { return that._onceTriggers; }
};

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext.GDObjectObjects1.length = 0;
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext.GDObjectObjects2.length = 0;

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext.eventsList0(runtimeScene, eventsFunctionContext);
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext.GDObjectObjects1.length = 0;
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsStartPositionContext.GDObjectObjects2.length = 0;


return !!eventsFunctionContext.returnValue;
}
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext = {};
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext.idToCallbackMap = new Map();
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext.GDObjectObjects1= [];
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext.GDObjectObjects2= [];


gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext.eventsList0 = function(runtimeScene, eventsFunctionContext) {

{

gdjs.copyArray(eventsFunctionContext.getObjects("Object"), gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext.GDObjectObjects1);

let isConditionTrue_0 = false;
isConditionTrue_0 = false;
for (var i = 0, k = 0, l = gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext.GDObjectObjects1.length;i<l;++i) {
    if ( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext.GDObjectObjects1[i].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")).EndX(eventsFunctionContext) == eventsFunctionContext.getArgument("X") ) {
        isConditionTrue_0 = true;
        gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext.GDObjectObjects1[k] = gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext.GDObjectObjects1[i];
        ++k;
    }
}
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext.GDObjectObjects1.length = k;
if (isConditionTrue_0) {
isConditionTrue_0 = false;
for (var i = 0, k = 0, l = gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext.GDObjectObjects1.length;i<l;++i) {
    if ( gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext.GDObjectObjects1[i].getBehavior(eventsFunctionContext.getBehaviorName("Behavior")).EndY(eventsFunctionContext) == eventsFunctionContext.getArgument("Y") ) {
        isConditionTrue_0 = true;
        gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext.GDObjectObjects1[k] = gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext.GDObjectObjects1[i];
        ++k;
    }
}
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext.GDObjectObjects1.length = k;
}
if (isConditionTrue_0) {
{eventsFunctionContext.returnValue = true;}
}

}


};

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPosition = function(X, Y, parentEventsFunctionContext) {

var that = this;
var runtimeScene = this._runtimeScene;
let scopeInstanceContainer = null;
var thisObjectList = [this.owner];
var Object = Hashtable.newFrom({Object: thisObjectList});
var Behavior = this.name;
var eventsFunctionContext = {
  _objectsMap: {
"Object": Object
},
  _objectArraysMap: {
"Object": thisObjectList
},
  _behaviorNamesMap: {
"Behavior": Behavior
},
  globalVariablesForExtension: runtimeScene.getGame().getVariablesForExtension("Level"),
  sceneVariablesForExtension: runtimeScene.getScene().getVariablesForExtension("Level"),
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
if (argName === "X") return X;
if (argName === "Y") return Y;
    return "";
  },
  getOnceTriggers: function() { return that._onceTriggers; }
};

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext.GDObjectObjects1.length = 0;
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext.GDObjectObjects2.length = 0;

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext.eventsList0(runtimeScene, eventsFunctionContext);
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext.GDObjectObjects1.length = 0;
gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.IsEndPositionContext.GDObjectObjects2.length = 0;


return !!eventsFunctionContext.returnValue;
}

gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior.prototype.doStepPreEvents = function() {
  this._onceTriggers.startNewFrame();
};


gdjs.registerBehavior("Level::RoadTileBehavior", gdjs.evtsExt__Level__RoadTileBehavior.RoadTileBehavior);
