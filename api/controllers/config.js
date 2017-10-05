'use strict';
var request = require('request');

module.exports.getConfig = (req, res) => {

    let settings = [];

    let cfg = global.config;

    let p = [];

    if (!cfg.auth || !cfg.auth.token){

        let apiKey = 'crcLaVjD5CBmZ4qduhnqHL7ce03ZKEOB';

        let url = `https://api.ecobee.com/authorize?response_type=ecobeePin&client_id=${apiKey}&scope=smartWrite`;

        p.push( new Promise( ( fulfill, reject ) => {

            request(url, function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    let ecobeePin = JSON.parse(body);

                    cfg.auth = { pin : ecobeePin };

                    fulfill();
                }else{
                    reject(error || response)
                }
            });
        }) );



    }

    res.json( settings );
};

module.exports.updateConfig = (req, res) => {
};


