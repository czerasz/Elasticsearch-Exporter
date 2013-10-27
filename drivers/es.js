var http = require('http');
http.globalAgent.maxSockets = 30;

exports.getMeta = function(opts, callback) {
    console.log('Reading mapping from ElasticSearch');
    var source = '/';
    if (opts.sourceIndex) {
        source += opts.sourceIndex + '/';
    }
    if (opts.sourceType) {
        source += opts.sourceType + '/';
    }
    var options = { host: opts.sourceHost, port: opts.sourcePort, path: source + '_mapping' };
    http.get(options, function(res) {
        var data = '';
        res.on('data', function(chunk) {
            data += chunk;
        });
        res.on('end', function() {
            if (opts.sourceIndex) {
                getSettings(opts, JSON.parse(data), callback)
            } else {
                getSettings(opts, { mappings: JSON.parse(data) }, callback)
            }
        });
    }).on('error', console.log);
};

function getSettings(opts, metadata, callback) {
    metadata.scope = 'all';
    var source = '/';
    if (opts.sourceIndex) {
        metadata.scope = 'index';
        source += opts.sourceIndex + '/';
    }
    if (opts.sourceType) {
        metadata.scope = 'type';
        callback(metadata);
        return;
    }
    // Get settings for either 'index' or 'all' scope
    var options = { host: opts.sourceHost, port: opts.sourcePort, path: source + '_settings' };
    http.get(options,function (res) {
        var data = '';
        res.on('data', function (chunk) {
            data += chunk;
        });
        res.on('end', function () {
            metadata.settings = JSON.parse(data).settings;
            callback(metadata);
        });
    }).on('error', console.log);
}

exports.createTypeMeta = function(opts, metadata, callback) {
    console.log('Creating type mapping in target ElasticSearch instance');
    var target = '/';
    if (opts.sourceIndex) {
        target += opts.targetIndex + '/';
    }
    if (opts.sourceType) {
        target += opts.targetType + '/';
    }
	var createIndexReq = http.request({
		host : opts.targetHost,
		port : opts.targetPort,
		path : '/' + opts.targetIndex,
		method : 'PUT'
	}, function() {
		var typeMapReq = http.request({
			host : opts.targetHost,
			port : opts.targetPort,
			path : target + '_mapping',
			method : 'PUT'
		}, callback);
		typeMapReq.on('error', console.log);
		typeMapReq.end(JSON.stringify({
            metadata: metadata.metadata
        }));
	});
	createIndexReq.on('error', console.log);
	createIndexReq.end();
};

exports.createIndexMeta = function(opts, metadata, callback) {
    console.log('Creating index mapping in target ElasticSearch instance');
	var createIndexReq = http.request({
		host : opts.targetHost,
		port : opts.targetPort,
		path : '/' + opts.targetIndex,
		method : 'PUT'
	}, callback);
	createIndexReq.on('error', console.log);
	createIndexReq.end(JSON.stringify({
        settings: metadata[opts.sourceIndex],
		mappings: metadata[opts.sourceIndex]
	}));
};

exports.createAllMeta = function(opts, metadata, callback) {
    console.log('Creating entire mapping in target ElasticSearch instance');
	var numIndices = 0;
	var indicesDone = 0;
    function done() {
        indicesDone++;
        if (numIndices == indicesDone) {
            callback();
        }
    }
	for (var index in metadata.mappings) {
		numIndices++;
		var createIndexReq = http.request({
			host : opts.targetHost,
			port : opts.targetPort,
			path : '/' + index,
			method : 'PUT'
		}, done);
		createIndexReq.on('error', console.log);
		createIndexReq.end(JSON.stringify({
            settings: metadata.settings[index],
			mappings: metadata.mappings[index]
		}));
	}
};

var scrollId = null;
exports.getData = function(opts, callback, retries) {
    if (!retries) {
        retries = 0;
    } else {
        if (retries == opts.errorsAllowed) {
            console.log('Maximum number of retries for fetching data reached. Aborting!')
            process.exit(1);
        }
        retries++;
    }

    var query = {
        fields : [
            '_source', '_timestamp', '_version', '_routing', '_percolate', '_parent', '_ttl'
        ],
        size : opts.sourceSize,
        query : opts.sourceQuery
    };
    if (opts.sourceIndex) {
        query = {
            fields : [
                '_source', '_timestamp', '_version', '_routing', '_percolate', '_parent', '_ttl'
            ],
            size : opts.sourceSize,
            query : {
                indices : {
                    indices : [
                        opts.sourceIndex
                    ],
                    query : opts.sourceQuery,
                    no_match_query : 'none'
                }
            }
        };
    }
    if (opts.sourceType) {
        query = {
            fields : [
                '_source', '_timestamp', '_version', '_routing', '_percolate', '_parent', '_ttl'
            ],
            size : opts.sourceSize,
            query : {
                indices : {
                    indices : [
                        opts.sourceIndex
                    ],
                    query : opts.sourceQuery,
                    no_match_query : 'none'
                }
            },
            filter : {
                type : {
                    value : opts.sourceType
                }
            }
        };
    }

    function handleResult(result) {
        var data = '';
        result.on('data', function(chunk) {
            data += chunk;
        });
        result.on('end', function() {
            try {
                data = JSON.parse(data);
            } catch (e) {}
            scrollId = data._scroll_id;
            callback(data.hits ? data.hits.hits : [], data.hits.total);
        });
    }

    if (scrollId !== null) {
        var scrollReq = http.request({
            host : opts.sourceHost,
            port : opts.sourcePort,
            path : '/_search/scroll?scroll=5m',
            method : 'POST'
        }, handleResult);
        scrollReq.on('error', function(err) {
            console.log(err);
            setTimeout(function() {
                exports.getData(opts, callback, retries);
            }, 1000);
        });
        scrollReq.end(scrollId);
    } else {
        var firstReq = http.request({
            host : opts.sourceHost,
            port : opts.sourcePort,
            path : '/_search?search_type=scan&scroll=5m',
            method : 'POST'
        }, handleResult);
        firstReq.on('error', function (err) {
            console.log(err);
            setTimeout(function () {
                exports.getData(opts, callback, retries);
            }, 1000);
        });
        firstReq.end(JSON.stringify(query));
    }
};

exports.storeHits = function(opts, data, callback, retries) {
    if (!retries) {
        retries = 0;
    } else {
        if (retries == opts.errorsAllowed) {
            console.log('Maximum number of retries for writing data reached. Aborting!')
            process.exit(1);
        }
        retries++;
    }

    var putReq = http.request({
		host : opts.targetHost,
		port : opts.targetPort,
		path : '_bulk',
		method : 'POST'
	}, function(res) {
		//Data must be fetched, otherwise socket won't be set to free
		res.on('data', function (chunk) {});
		callback();
	});
    putReq.on('error', function (err) {
        console.log(err);
        setTimeout(function () {
            exports.storeHits(opts, data, callback, retries);
        }, 1000);
    });
	putReq.end(data);
};
