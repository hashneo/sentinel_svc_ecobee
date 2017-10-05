'use strict';
require('array.prototype.find');

function ecobee(config) {

    if ( !(this instanceof ecobee) ){
        return new ecobee(config);
    }

    var ecobeeApi = require('./ecobee-api');

    const redis = require('redis');
    var moment = require('moment');

    let pub = redis.createClient(
        {
            host: process.env.REDIS || global.config.redis || '127.0.0.1' ,
            socket_keepalive: true,
            retry_unfulfilled_commands: true
        }
    );

    pub.on('ready', function(e){
        let data = JSON.stringify( { module: 'ecobee', service: { name: 'sentinel-ecobee', port: 5050 } });
        pub.publish( 'sentinel.plugin.start', data);
    });

    pub.on('end', function(e){
        console.log('Redis hung up, committing suicide');
        process.exit(1);
    });

    var NodeCache = require( "node-cache" );

    var deviceCache = new NodeCache();
    var statusCache = new NodeCache();

    var merge = require('deepmerge');

    var request = require('request');

/*
    require('request').debug = true
    require('request-debug')(request);
*/

    deviceCache.on( 'set', function( key, value ){
        let data = JSON.stringify( { module: 'ecobee', id : key, value : value });
        console.log( 'sentinel.device.insert => ' + data );
        pub.publish( 'sentinel.device.insert', data);
    });

    deviceCache.on( 'delete', function( key ){
        let data = JSON.stringify( { module: 'ecobee', id : key });
        console.log( 'sentinel.device.delete => ' + data );
        pub.publish( 'sentinel.device.delete', data);
    });

    statusCache.on( 'set', function( key, value ){
        let data = JSON.stringify( { module: 'ecobee', id : key, value : value });
        console.log( 'sentinel.device.update => ' + data );
        pub.publish( 'sentinel.device.update', data);
    });

	var that = this;

	var deviceMap = {};

    this.getDevices = () => {

        return new Promise( (fulfill, reject) => {
            deviceCache.keys( ( err, ids ) => {
                if (err)
                    return reject(err);

                deviceCache.mget( ids, (err,values) =>{
                    if (err)
                        return reject(err);

                    statusCache.mget( ids, (err, statuses) => {
                        if (err)
                            return reject(err);

                        let data = [];

                        for (let key in values) {
                            let v = values[key];

                            if ( statuses[key] ) {
                                v.current = statuses[key];
                                data.push(v);
                            }
                        }

                        fulfill(data);
                    });

                });
            });
        });
    };

    this.getDeviceStatus = (id) => {

        return new Promise( (fulfill, reject) => {
            try {
                statusCache.get(id, (err, value) => {
                    if (err)
                        return reject(err);

                    fulfill(value);
                }, true);
            }catch(err){
                reject(err);
            }
        });

    };

    this.setFanMode = (id, mode) =>{
        return new Promise( (fulfill, reject) => {
            switch (mode) {
                case 'auto':
                case 'off':
                    mode = 'auto';
                    break;
                case 'continuous':
                case 'periodic':
                    mode = 'on';
                    break;
            }
            try {
                ecobeeApi.setFanMode(id, mode);
                fulfill();
            }catch(err){
                reject(err);
            }
        });
    };

    this.setHvacMode = (id, mode) =>{
        return new Promise( (fulfill, reject) => {

            if ( mode === 'auto')
                mode = 'range';

            try {

                let structureId = deviceMap[id].structureId;

                switch ( mode ) {
                    case 'away':
                        ecobeeApi.setAway(true, structureId);
                        break;
                    case 'home':
                        ecobeeApi.setHome(structureId);
                        break;
                    default:
                        ecobeeApi.setTargetTemperatureType(id, mode);
                        break;
                }

                fulfill();
            }catch(err){
                reject(err);
            }
        });
    };

    this.setHvacTemp_H = (id, value) =>{
        return new Promise( (fulfill, reject) => {

            statusCache.get(id, (err, current) => {
                if (err)
                    return reject(err);

                current.temperature.heat.set = value;

                try {
                    switch (current.mode){
                        case 'heat':
                            ecobeeApi.setTemperature( id, value );
                            break;
                        case 'auto':
                            ecobeeApi.setTemperatureRange( id, current.temperature.heat.set, current.temperature.cool.set );
                            break;
                        case 'off':
                        case 'cool':
                            reject(new Error('invalid mode'));
                            break;
                    }

                    statusCache.set(id, current);

                    fulfill();
                }catch(err){
                    reject(err);
                }
            }, true);

        });
    };

    this.setHvacTemp_C = (id, value) =>{
        return new Promise( (fulfill, reject) => {

            statusCache.get(id, (err, current) => {
                if (err)
                    return reject(err);

                current.temperature.cool.set = value;

                try {
                    switch (current.mode){
                        case 'cool':
                            ecobeeApi.setTemperature( id, value);
                            break;
                        case 'auto':
                            ecobeeApi.setTemperatureRange( id, current.temperature.heat.set, current.temperature.cool.set );
                            break;
                        case 'off':
                        case 'heat':
                            reject(new Error('invalid mode'));
                            break;
                    }

                    statusCache.set(id, current);

                    fulfill();
                }catch(err){
                    reject(err);
                }
            }, true);

        });
    };


    function updateStatus() {
        return new Promise( ( fulfill, reject ) => {
            try {
                fulfill();
            }catch(err){
                reject(err);
            }
        });
    }

    this.Reload = () => {
        return new Promise( (fulfill,reject) => {
            fulfill([]);
        });
    };

    function loadSystem(){
        return new Promise( ( fulfill, reject ) => {
            try {
                fulfill();
            } catch(err){
                reject(err);
            }
        });
    }

    loadSystem()

        .then( () => {

            function pollSystem() {
                updateStatus()
                    .then(() => {
                        setTimeout(pollSystem, 10000);
                    })
                    .catch((err) => {
                        console.error(err);
                        process.exit(1);
                        //setTimeout(pollSystem, 60000);
                    });
            }

            setTimeout(pollSystem, 10000);

        })
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });

    return this;
}

module.exports = ecobee;