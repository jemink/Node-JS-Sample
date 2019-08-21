process.on('uncaughtException', (exception) => console.log(exception));
require('events').EventEmitter.defaultMaxListeners = Infinity;
const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const fileUpload = require('express-fileupload');
const httpStatus = require('http-status');
const exphbs = require('express-handlebars');
const APIError = require('./helpers/APIError');
const SetupHelper = require('./helpers/setup.helper');
const Cron = require('./services/cron.service');

const apiRouter = require('./routers/api.router');

const apiApp = express();
apiApp.use(helmet());
apiApp.use(cors());
apiApp.use(fileUpload({ limits: { fileSize: 500 * 1024 * 1024 } }));
apiApp.options('/*', (...args) => SetupHelper.setHeaders(...args));
apiApp.use(bodyParser.json({ limit: '500mb' }));
apiApp.use(bodyParser.urlencoded({
    extended: true
}));
apiApp.use(express.static('public'));
apiApp.engine('handlebars', exphbs());
apiApp.set('view engine', 'handlebars');

apiApp.use('/', apiRouter);

apiApp.use((req, res, next) => next(new APIError('API not found', httpStatus.NOT_FOUND)));
apiApp.use((err, req, res, next) => SetupHelper.errorOutput(err, req, res, next));

exports.api = functions.https.onRequest(apiApp);

exports.daily_job = functions.pubsub.topic('daily-tick').onPublish((message) => {
    console.log('Daily CRON Job');
    if (message.data) {
        const dataString = Buffer.from(message.data, 'base64').toString();
        console.log(`Message Data: ${dataString}`);
    }
    Cron.dailyJob()
        .then(() => console.log('Cron task has finished running'))
        .catch((error) => console.error(error));
    return true;
});

exports.every_15min_tick = functions.pubsub.topic('every-15min-tick').onPublish((message) => {
    console.log('Evry 15 Minutes CRON Job');
    if (message.data) {
        const dataString = Buffer.from(message.data, 'base64').toString();
        console.log(`Message Data: ${dataString}`);
    }
    Cron.every15minjob()
        .then(() => console.log('Cron task has finished running'))
        .catch((error) => console.error(error));
    return true;
});
