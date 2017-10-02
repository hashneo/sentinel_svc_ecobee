'use strict';

module.exports.setHvacMode = (req, res) => {

    let id = req.swagger.params.id.value;
    let mode = req.swagger.params.mode.value;

    global.module.setHvacMode(id, mode )
        .then( (status) => {
            res.json( { data: { status: status }, result : 'ok' } );
        })
        .catch( (err) => {
            res.status(500).json( { code: err.code || 0, message: err.message } );
        });
};

module.exports.setHvacTemp = (req, res) => {

    let id = req.swagger.params.id.value;
    let mode = req.swagger.params.mode.value;
    let temp = req.swagger.params.temp.value;

    let setHvacTemp;

    switch (mode){
        case 'heat':
            setHvacTemp = global.module.setHvacTemp_H(id, temp);
            break;
        case 'cool':
            setHvacTemp = global.module.setHvacTemp_C(id, temp);
            break;
    }

    setHvacTemp
        .then( (status) => {
            res.json( { data: { status: status }, result : 'ok' } );
        })
        .catch( (err) => {
            res.status(500).json( { code: err.code || 0, message: err.message } );
        });

};

module.exports.setHvacFanMode = (req, res) => {

    let id = req.swagger.params.id.value;
    let mode = req.swagger.params.mode.value;


    global.module.setFanMode(id, mode )
        .then( (status) => {
            res.json( { data: { status: status }, result : 'ok' } );
        })
        .catch( (err) => {
            res.status(500).json( { code: err.code || 0, message: err.message } );
        });

};
