var sanitize = require('sanitize-caja');
var _ = require('underscore');
var log = require('./log');
var debug = require('debug')('runcheck:req-utils');


function is(type) {
  return function (req, res, next) {
    if (req.is(type)) {
      next();
    } else {
      return res.status(415).send('require ' + type);
    }
  }
}

/**
 * Check the property list of http request. Set the property to null if it is
 *   not in the give names list. Go next() if at least one in the give names
 *   list, otherwise respond 400
 * @param  {String} list    'body'|'params'|'query'
 * @param  {[String]} names The property list to check against
 * @return {Function}       The middleware
 */
function filter(list, names) {
  return function (req, res, next) {
    var k;
    var found = false;
    for (k in req[list]) {
      if (req[list].hasOwnProperty(k)) {
        if (names.indexOf(k) !== -1) {
          found = true;
        } else {
          // delete for safe
          delete req[list][k];
        }
      }
    }
    if (found) {
      next();
    } else {
      return res.status(400).send('cannot find required information in ' + list);
    }
  };
}


function sanitizeJson(input) {
  var jsonString = JSON.stringify(input);
  jsonString = sanitize(jsonString);
  var output = null;
  try {
    output = JSON.parse(jsonString);
  } catch (e) {
    log.error(e);
  }
  return output;
}

/**
 * Sanitize the property list of http request
 * @param  {String} list    'body'|'params'|'query'
 * @return {Function}       The middleware
 */
function sanitizeMw(list) {
  return function (req, res, next) {
    var n;
    for(n in req[list]){
      if (req[list].hasOwnProperty(n)) {
        if (_.isString(req[list][n])) {
          req[list][n] = sanitize(req[list][n]);
        }

        if (_.isObject(req[list][n]) || _.isArray(req[list][n])) {
          req[list][n] = sanitizeJson(req[list][n]);
        }
      }
    }
    next();
  };
}

/**
 * Check if the request[list] has all the properties in the names list
 * @param  {String}  list    'body'|'params'|'query'
 * @param  {[String]}  names The property list to check
 * @return {Function}        The middleware
 */
function hasAll(list, names) {
  return function (req, res, next) {
    var i;
    var miss = false;
    for (i = 0; i < names.length; i += 1) {
      if (!req[list].hasOwnProperty(names[i])) {
        miss = true;
        break;
      }
    }
    if (miss) {
      return res.status(400).send('cannot find required information in ' + list);
    }
    next();
  };
}

/**
 * Check if id exists in collection
 * @param  {String} pName         the parameter name of item id in req object
 * @param  {Model} model     the model
 * @param  {String} property      the property the query in the collection,
 *                                default: _id
 * @return {Function}             the middleware
 */
function exist(pName, model, property) {
  property = typeof property === 'undefined' ? '_id' : property;
  return function (req, res, next) {
    var query = {};
    query[property] = req.params[pName];
    model.findOne(query).exec(function (err, item) {
      if (err) {
        log.error(err);
        return res.status(500).send(err.message);
      }

      debug('the collection name is ' + model.collection.collectionName);
      if (!item) {
        return res.status(404).send('item ' + req.params[pName] + ' not found in ' + model.collection.collectionName);
      }

      req[req.params[pName]] = item;
      next();
    });
  };
}

/**
 * check if the document in a certain status (list)
 * @param  {String} pName the parameter name of item id in req object
 * @param  {[Number]} sList the allowed status list
 * @return {Function}       the middleware
 */
function status(pName, sList) {
  return function (req, res, next) {
    var s = req[req.params[pName]].status;
    if (sList.indexOf(s) === -1) {
      return res.status(400).send('request is not allowed for item ' + req.params[pName] + ' status ' + s);
    }
    next();
  };
}

/**
 * check if the document is archived
 * @param  {String} pName the parameter name of item id in req object
 * @param  {Boolean} a    true or false
 * @return {Function}     the middleware
 */
function archived(pName, a) {
  return function (req, res, next) {
    var arch = req[req.params[pName]].archived;
    if (a !== arch) {
      return res.status(400).send('request is not allowed for item ' + req.params[pName] + ' archived ' + arch);
    }
    next();
  };
}

/*****
 access := -1 // no access
 | 0  // read
 | 1  // write
 *****/

function getAccess(req, doc) {
  if (doc.publicAccess === 1) {
    return 1;
  }
  if (doc.createdBy === req.session.userid && !doc.owner) {
    return 1;
  }
  if (doc.owner === req.session.userid) {
    return 1;
  }
  if (doc.sharedWith && doc.sharedWith.id(req.session.userid)) {
    return doc.sharedWith.id(req.session.userid).access;
  }
  var i;
  if (doc.sharedGroup) {
    for (i = 0; i < req.session.memberOf.length; i += 1) {
      if (doc.sharedGroup.id(req.session.memberOf[i]) && doc.sharedGroup.id(req.session.memberOf[i]).access === 1) {
        return 1;
      }
    }
    for (i = 0; i < req.session.memberOf.length; i += 1) {
      if (doc.sharedGroup.id(req.session.memberOf[i])) {
        return 0;
      }
    }
  }
  if (doc.publicAccess === 0) {
    return 0;
  }
  return -1;
}

function canWrite(req, doc) {
  return getAccess(req, doc) === 1;
}


/**
 * check if the user can write the document, and go next if yes
 * @param  {String} pName the document to check
 * @return {Function}     the middleware
 */
function canWriteMw(pName) {
  return function (req, res, next) {
    if (!canWrite(req, req[req.params[pName]])) {
      return res.status(403).send('you are not authorized to access this resource');
    }
    next();
  };
}


function canRead(req, doc) {
  return getAccess(req, doc) >= 0;
}

/**
 * check if the user can read the document, and go next if yes
 * @param  {String} pName the parameter name identifying the object
 * @return {Function}     the middleware
 */
function canReadMw(pName) {
  return function (req, res, next) {
    if (!canRead(req, req[req.params[pName]])) {
      return res.status(403).send('you are not authorized to access this resource');
    }
    next();
  };
}

function isOwner(req, doc) {
  if (doc.createdBy === req.session.userid && !doc.owner) {
    return true;
  }
  if (doc.owner === req.session.userid) {
    return true;
  }
  return false;
}

/**
 * check if the user is the owner of the document, if yes next()
 * @param  {String}  pName the object's id to check
 * @return {Function}      the middleware
 */
function isOwnerMw(pName) {
  return function (req, res, next) {
    if (!isOwner(req, req[req.params[pName]])) {
      return res.status(403).send('you are not authorized to access this resource');
    }
    next();
  };
}

function getSharedWith(sharedWith, name) {
  var i;
  if (sharedWith.length === 0) {
    return -1;
  }
  for (i = 0; i < sharedWith.length; i += 1) {
    if (sharedWith[i].username === name) {
      return i;
    }
  }
  return -1;
}

function getSharedGroup(sharedGroup, id) {
  var i;
  if (sharedGroup.length === 0) {
    return -1;
  }
  for (i = 0; i < sharedGroup.length; i += 1) {
    if (sharedGroup[i]._id === id) {
      return i;
    }
  }
  return -1;
}


module.exports = {
  is: is,
  filter: filter,
  hasAll: hasAll,
  sanitize: sanitizeMw,
  exist: exist,
  status: status,
  archived: archived,
  canRead: canRead,
  canReadMw: canReadMw,
  canWrite: canWrite,
  canWriteMw: canWriteMw,
  isOwner: isOwner,
  isOwnerMw: isOwnerMw,
  getAccess: getAccess,
  getSharedWith: getSharedWith,
  getSharedGroup: getSharedGroup
};
