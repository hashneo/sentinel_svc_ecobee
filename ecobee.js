'use strict';
require('array.prototype.find');

function ecobee(config) {

    if ( !(this instanceof ecobee) ){
        return new ecobee(config);
    }

    var ecobeeApi = require('ecobee-api');

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

    // off, heat, cool, auto
    function getHvacMode(shared){
        if ( shared.target_temperature_type === 'range')
            return 'auto';
        return shared.target_temperature_type;
    }

    // off, heating, cooling
    function getHvacState(shared){
        if ( shared.hvac_heater_state )
            return 'heating';
        if ( shared.hvac_ac_state )
            return 'cooling';

        return 'off';
    }

    // auto, continuous, periodic
    function getFanMode(device){
        if ( device.fan_timer_timeout > 0 )
            return 'periodic';
        if ( device.fan_mode == 'on')
            return 'continuous';
        if ( device.fan_mode == 'auto')
            return 'auto';
    }

    function getFanState(shared){
        return shared.hvac_fan_state;
    }

    function fillStructure(_deviceId, data){

        let device = data.device[_deviceId];
        let shared = data.shared[_deviceId];

        let status = {
            mode: getHvacMode(shared),
            state: getHvacState(shared),
            fan: {
                mode: getFanMode(device),
                running: getFanState(shared)
            },
            temperature: {
                cool: {
                    set: null
                },
                heat: {
                    set: null
                },
                current: ecobeeApi.ctof(shared.current_temperature),
                humidity: device.current_humidity
            },
            battery: {
                level: device.battery_level
            }
        };

        switch (status.mode){
            case 'heat':
                status.temperature.heat.set = ecobeeApi.ctof(shared.target_temperature);
                break;
            case 'cool':
                status.temperature.cool.set = ecobeeApi.ctof(shared.target_temperature);
                break;
            case 'auto':
                status.temperature.cool.set = ecobeeApi.ctof(shared.target_temperature_high);
                status.temperature.heat.set = ecobeeApi.ctof(shared.target_temperature_low);
                break;
            case 'off':
        }
        return status;
    }


    function updateStatus() {
        return new Promise( ( fulfill, reject ) => {
            try {
                ecobeeApi.fetchStatus((data) => {

                    if ( data ) {
                        let structures = Object.keys(data.structure);
                        for (let x in structures) {

                            let _structure = data.structure[structures[x]];
                            let _devices = Object.keys(_structure.devices);
                            for (let y in _devices) {
                                let _deviceId = _structure.devices[_devices[y]].split('.')[1];
                                let status = fillStructure(_deviceId, data);
                                statusCache.set(_deviceId, status);
                            }

                        }
                    }
                    fulfill();
                });
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
                ecobeeApi.login(global.config.email, global.config.password, (err, session) => {

                    if ( err ){
                        reject(err);
                        return;
                    }

                    ecobeeApi.fetchStatus((data) => {
                        let devices = [];

                        let structures = Object.keys(data.structure);
                        for (let x in structures) {

                            let structureId = structures[x];

                            let _structure = data.structure[structureId];

                            let _devices = Object.keys(_structure.devices);
                            for (let y in _devices) {

                                let _deviceId = _structure.devices[_devices[y]].split('.')[1];
                                let status = fillStructure(_deviceId, data);
                                let shared = data.shared[_deviceId];

                                deviceMap[_deviceId] = {
                                    structureId : structureId
                                };

                                let d = {
                                    name: shared.name,
                                    id: _deviceId,
                                    where: {'location': { city: _structure.location, room: _structure.name } },
                                    type: 'hvac',
                                    current: {}
                                };

                                deviceCache.set(d.id, d);

                                devices.push(d);


                                statusCache.set(_deviceId, status);
                            }
                        }

                        fulfill(devices);
                    });
                });
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