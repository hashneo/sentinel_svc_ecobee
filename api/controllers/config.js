'use strict';

const ecobeeApi = require('../../ecobee-api.js');

module.exports.getConfig = (req, res) => {

    let cfg = global.config;

    let p = [];

    if (!cfg.auth || !cfg.auth.token){

        p.push( new Promise( ( fulfill, reject ) => {

            ecobeeApi.requestPin()
                .then( (ecobeePin) => {
                    cfg.auth = { pin : ecobeePin };

                    cfg.save();

                    return fulfill( {
                        name: 'auth',
                        value: cfg.auth,
                        required: true
                    } );
                })
                .catch( (err) =>{
                    reject(err);
                });

        }) );

    }

    Promise.all( p )
        .then( (settings) => {
            res.json(settings);
        })
        .catch( (err) => {
            res.status(500).json( { code: err.code || 0, message: err.message } );
        });
};

module.exports.updateConfig = (req, res) => {
};


