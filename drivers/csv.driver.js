var fs = require('fs');

var log = require('../log.js');


var id = 'csv';

exports.getInfo = function (callback) {
    var info = {
        id: id,
        name: 'CSV Driver',
        version: '1.0',
        desciption: ' A CSV driver to export data that maps all fields to columns'
    };
    var options = {
        target: {
            noheader: {
                abbr: 'h',
                help: 'Whether to include a header row or not',
                flag: true,
                preset: false
            }, separator: {
                abbr: 's',
                help: 'The separator to use between columns',
                preset: ','
            }, quoteEverything: {
                abbr: 'q',
                help: 'Whether to force to have all values encapsulated in quotes',
                flag: true,
                preset: false
            }, trimData: {
                abbr: 't',
                help: 'Whether to trim data in columns and strip wihtespace from beginning/end',
                flag: true,
                preset: false
            }, unixQuotes: {
                abbr: 'c',
                help: 'Whether to use "" (standard) to escape quotes or \\"',
                flag: true,
                preset: false
            }, file: {
                abbr: 'f',
                help: 'The file to which the data should be exported.',
                required: true
            }, append: {
                abbr: 'a',
                help: 'If a file exists append or overwrite existing data',
                flag: true,
                preset: false
            }
        }
    };
    callback(null, info, options);
};

exports.verifyOptions = function (opts, callback) {
    var err = [];
    if (opts.drivers.source == id) {
        err.push("The CSV driver doesn't support import operations.");
    }
    if (opts.drivers.target == id) {
        if (fs.existsSync(opts.target.file)) {
            log.info('Warning: ' + opts.target.file + ' already exists, duplicate entries might occur');
        }
        if (opts.target.separator.trim === '') {
            err.push('Seperator is empty, resulting file will not be a CSV');
        }
    }
    callback(err);
};

var indexCounter = 0;
var propertyMap = {};

exports.reset = function (env, callback) {
    propertyMap = {};
    indexCounter = 0;
    callback();
};

exports.getTargetStats = function (env, callback) {
    callback(null, {
        version: "1.0.0",
        cluster_status: "Green"
    });
};

exports.getSourceStats = function (env, callback) {
    throw new Error("CSV driver doesn't support import operations");
};

exports.getMeta = function (env, callback) {
    throw new Error("CSV driver doesn't support import operations");
};

exports.escape = function(env, data) {
    if (!data) {
        return '';
    }
    if (!isNaN(data)) {
        return data;
    }
    if (typeof data === 'object') {
        data = JSON.stringify(data);
    }
    if (env.options.target.trimData) {
        data = data.trim();
    }
    if (env.options.target.quoteEverything
        || data.indexOf('\n') !== -1
        || data.indexOf('"') !== -1
        || data.indexOf(env.options.target.separator) !== -1) {
        if (env.options.target.unixQuotes) {
            data = data.replace('"', '\\"');
        } else {
            data = data.replace('"', '""');
        }
        data =  "\"" + data + "\"";
    }
    return data;
};

exports.putMeta = function (env, metadata, callback) {
    if (!env.options.target.append) {
        fs.writeFileSync(env.options.target.file, '', {encoding: 'utf8'});
    }
    var separator = env.options.target.separator;
    var header;
    if (env.options.target.quoteEverything) {
        header = '"index"' + separator + '"type"';
    } else {
        header = 'index' + separator + 'type';
    }
    for (var mapping in metadata.mappings) {
        for (var index in metadata.mappings[mapping]) {
            for (var type in metadata.mappings[mapping][index]) {
                for (var property in metadata.mappings[mapping][index][type]) {
                    if (!propertyMap[property]) {
                        propertyMap[property] = indexCounter++;
                        header += separator + exports.escape(env, property);
                    }
                }
            }
        }

    }
    if (!env.options.target.noheader) {
        if (!fs.existsSync(env.options.target.file) || fs.statSync(env.options.target.file).size === 0) {
            fs.writeFileSync(env.options.target.file, header + '\n', {encoding: 'utf8'});
        }
    }
    callback();
};

exports.getData = function (env, callback) {
    throw new Error("CSV driver doesn't support import operations");
};

exports.putData = function (env, docs, callback) {
    for (var i in docs) {
        var line = [propertyMap.length];
        for (var property in docs[i]._source) {
            line[propertyMap[property]] = exports.escape(env, docs[i]._source[property]);
        }
        line.unshift(docs[i]._type);
        line.unshift(docs[i]._index);
        fs.appendFile(env.options.target.file, line.join(env.options.target.separator) + '\n', {encoding: 'utf8'});
    }
    callback();
};