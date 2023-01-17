// load variables from .env file in process.env
require('dotenv').config();

// create express server
const express = require('express');
const app = express();
const PORT = process.env.port || 3000;
//auth for freshdesk
var auth = Buffer.from("hUZ0KdWCy3i9Dsu320Pm:X").toString('base64')
var fs = require('fs');

// parse request body
// twilio sends application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }))
app.use(express.json());

// create twilio client for interacting with twilio
const twilioClient = require('twilio')(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN,
);

// create dialogflow session client
const dialogflow = require('@google-cloud/dialogflow');
const sessionClient_dialogFlow = new dialogflow.SessionsClient();

// create vision session client
const vision = require('@google-cloud/vision');
const sessionClient_vision = new vision.ImageAnnotatorClient({
    keyFileName: process.env.GOOGLE_APPLICATION_CREDENTIALS
});

//create vertex ai session client
//const { DatasetServiceClient } = require('@google-cloud/aiplatform');
//const client = new DatasetServiceClient();

//Using Document AI

const projectId = '830095014426';
const processorLocation = 'us'; // Format is 'us' or 'eu'
const processorId = '7528ed4cd376b140'; // Create processor in Cloud Console
const validatorId = '3b85e3ee78ffe1d4';
//const filePath = '/path/to/local/pdf';

const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const documentAIClient = new DocumentProcessorServiceClient();

const processorName = `projects/${projectId}/locations/${processorLocation}/processors/${processorId}`;
const validatorName = `projects/${projectId}/locations/${processorLocation}/processors/${validatorId}`;

const axios = require('axios');
const { randomInt } = require('crypto');

// post request on /whatsapp endpoint
app.post('/whatsapp', async function (req, res) {

    // users whatsapp number
    const from = req.body.From;

    // sandbox whatsapp number
    const to = req.body.To;
    //media files
    const media = req.body.NumMedia == '0' ? null : req.body.MediaContentType0;
    // message contents
    const body = media == null ? req.body.Body
        : (media == 'image/jpeg' || media == 'image/jpg') ? "image url: " + req.body.MediaUrl0
            : "media type: " + media;

    //console.log("request: ", req);
    //console.log("request body: ", req.body);


    console.log(`Got message ${body} from ${from}`);

    // session for current user
    const projectId = await sessionClient_dialogFlow.getProjectId();
    const sessionPath = sessionClient_dialogFlow.projectAgentSessionPath(projectId, from);

    // request dialogflow to classify intent
    const response = await sessionClient_dialogFlow.detectIntent({
        session: sessionPath,
        queryInput: {
            text: {
                text: body,
                languageCode: 'es',
            }
        }
    });

    if (media != null) {
        //This is with Document AI

        // Read the file into memory.
        /* const fs = require('fs').promises;
        const localExampleFile = await fs.readFile(filepath); */

        const encodedImage = await axios.get(req.body.MediaUrl0, { responseType: 'arraybuffer' }).then(
            response => Buffer.from(response.data, 'binary').toString('base64')
        )

        //console.log("ENCODEDIMAGE: ", encodedImage)
        //console.log("DATA: ", imageFile.data)

        // Convert the image data to a Buffer and base64 encode it.
        //const encodedImage = Buffer.from(imageFile.data).toString('base64');

        //API request body
        const extractRequest = {
            name: processorName,
            rawDocument: {
                content: encodedImage,
                mimeType: 'image/jpeg',
            },
        };

        const validationRequest = {
            name: validatorName,
            skipHumanReview: true,
            inlineDocument: {
                content: encodedImage,
                mimeType: 'image/jpeg',
            },
        };

        // Validate if there is any falsification sign
        await documentAIClient.processDocument(validationRequest)
            .then(async (result) => {
                fs.appendFile('docProcessResults' + new Date().getTime() + '.json', JSON.stringify(result), function (err) {
                    if (err) throw err;
                    console.log('Content appended/file created.');
                });
                let entities = result[0].document.entities

                let fraudSignals = {};
                entities.forEach((entity) => {
                    fraudSignals[entity.type] = entity.mentionText;
                })

                console.log(fraudSignals)

                let fraudFlag = false;

                for (let key in fraudSignals) {
                    fraudFlag = fraudSignals[key] != 'PASS' ? true : false;
                    if (fraudFlag && true) break;
                }

                console.log(fraudFlag)

                if (!fraudFlag) {
                    // Recognizes text entities in the document
                    //Here we extract info
                    await documentAIClient.processDocument(extractRequest)
                        .then(async (result) => {
                            fs.appendFile('docProcessResults' + new Date().getTime() + '.json', JSON.stringify(result), function (err) {
                                if (err) throw err;
                                console.log('Content appended/file created.');
                            });

                            let entities = result[0].document.entities

                            let infoObj = {};
                            entities.forEach((entity) => {
                                infoObj[entity.type] = entity.mentionText;
                            })

                            console.log(infoObj);

                            let auxString = entities.length > 2 ?
                                `Nombre: ${infoObj.PATERNO} ${infoObj.MATERNO} ${infoObj.NOMBRE}\nDirección: ${infoObj.ADDRESS}\nFecha de nacimiento: ${infoObj.BIRTHDATE}\nClave de elector: ${infoObj.IDELECTOR}\nCurp: ${infoObj.CURP}\n`
                                :
                                `CIC: ${infoObj.CIC}\nOCR: ${infoObj.OCR}\n`
                            console.log(auxString)

                            let fullname = infoObj.PATERNO.replace(/(\r\n|\n|\r)/gm, "") + " "
                                + infoObj.MATERNO.replace(/(\r\n|\n|\r)/gm, "") + " "
                                + infoObj.NOMBRE.replace(/(\r\n|\n|\r)/gm, "");
                            let curp = infoObj.CURP.replace(/(\r\n|\n|\r)/gm, "");
                            let idElector = infoObj.IDELECTOR.replace(/(\r\n|\n|\r)/gm, "");
                            let address = infoObj.ADDRESS.replace(/(\r\n|\n|\r)/gm, "");
                            let birthdate = infoObj.BIRTHDATE.replace(/(\r\n|\n|\r)/gm, "");



                            //Este es el request body para la API de freshdesk
                            var requestBody = {
                                group_id: 70000466713,
                                description: "Cotización para seguro de vivienda",
                                subject: "Solicitud de cotización de seguro",
                                email: "jose@ptree.com.mx",
                                priority: 1,
                                source: 3,
                                status: 2,
                                type: "Atención a Clientes",
                                cc_emails: [
                                    "ram@freshdesk.com",
                                    "diana@freshdesk.com"
                                ],
                                custom_fields: {
                                    cf_correo: "test@ptree.com.mx",
                                    cf_nombre_del_solicitante: fullname,
                                    cf_telefono: null,
                                    cf_curp: curp,
                                    cf_clave_de_elector: idElector,
                                    cf_domicilio: address,
                                    cf_tipo_de_seguro: "Vivienda",
                                    cf_fecha_de_nacimiento: null
                                }
                            }

                            var config = {
                                headers: {
                                    "content-Type": "application/json",
                                    "Authorization": "Basic " + auth
                                }
                            }

                            let ticketID = null;

                            const res = await axios.post('https://ptree.freshdesk.com/api/v2/tickets', requestBody, config)
                                .then(async function (response) {
                                    console.log("Ticket levantado")
                                    //console.log(response.data)
                                    ticketID = response.data.id;
                                    await twilioClient.messages.create({
                                        from: to,
                                        to: from,
                                        body: `Se ha levantado exitosamente tu solicitud con el ID ${ticketID}.`
                                    });
                                })
                                .catch(function (error) {
                                    console.log(error);
                                });

                            /* await twilioClient.messages.create({
                                from: to,
                                to: from,
                                body: `Tu imagen contiene el siguiente texto\n\n${auxString}.`
                            }); */
                        });

                } else {
                    await twilioClient.messages.create({
                        from: to,
                        to: from,
                        body: `Lo sentimos, tu imagen no paso las validaciones de seguridad, por favor intentalo de nuevo.`
                    });
                }

            })

        //This is with Vision AI
        /* await sessionClient_vision
            .labelDetection(req.body.MediaUrl0)
            .then(async (result) => {
                const labels = result[0].labelAnnotations;
                var labelsText = "";
                labels.forEach((label) => console.log(label.description));
                labels.forEach((label) => labelsText = labelsText + ", " + label.description)

                await twilioClient.messages.create({
                    from: to,
                    to: from,
                    body: `Tu imagen contiene las siguientes etiquetas ${labelsText}.`
                });
            })
            .catch((error) => {
                console.log("Error: ", error);
            }) */

        /* await sessionClient_vision
            .textDetection(req.body.MediaUrl0)
            //.documentTextDetection(req.body.MediaUrl0)
            .then(async (result) => {
                fs.appendFile('detectionResults' + new Date().getTime() + '.json', JSON.stringify(result), function (err) {
                    if (err) throw err;
                    console.log('Content appended/file created.');
                });
                const text = result[0].textAnnotations;
                console.log("Text:");
                var words = "";
                text.forEach((phrase) => console.log(phrase.description));
                words = text[0].description;

                await twilioClient.messages.create({
                    from: to,
                    to: from,
                    body: `Tu imagen contiene el siguiente texto ${words}.`
                });
            })
            .catch((error) => {
                console.log("Error: ", error);
            }) */
    }

    //console.log("Response from DialogFlow API: ", response);//COMPLETE RESPONSE
    //console.log("Intent object: ", response[0].queryResult.intent);//INTENT OBJECT PROPERTIES
    //console.log("Fulfillment array: ", response[0].queryResult.fulfillmentMessages);//FULFILLMENT MESAGES
    //console.log("Parameters object: ", response[0].queryResult.parameters);//PARAMETERS
    //console.log("Fulfillment object in array: ", response[0].queryResult.fulfillmentMessages[0].text);//PARAMETERS

    // handler intent
    if (response[0].queryResult.fulfillmentText || response[0].queryResult.fulfillmentText != "") {

        if (response[0].queryResult.action == 'LevantarTicket.LevantarTicket-yes' && response[0].queryResult.allRequiredParamsPresent) {
            //AQUI LLAMAMOS LA API DE FRESHDESK
            //console.log("Query result: ", response[0].queryResult);//INTENT OBJECT PROPERTIES
            //console.log("Intent object: ", response[0].queryResult.intent);//INTENT OBJECT PROPERTIES
            //console.log("Fulfillment array: ", response[0].queryResult.fulfillmentMessages);//FULFILLMENT MESAGES
            //console.log("Parameters object: ", response[0].queryResult.parameters);//PARAMETERS
            //console.log("Fulfillment object in array: ", response[0].queryResult.fulfillmentMessages[0].text);//PARAMETERS

            console.log("solicitud completa")

            await twilioClient.messages.create({
                from: to,
                to: from,
                body: `Tu solicitud será creada en breves instantes, por favor espera la confirmación.`
            });

            var requestBody = {
                description: response[0].queryResult.parameters.fields.Descripcion.stringValue,
                subject: response[0].queryResult.parameters.fields.Asunto.stringValue,
                email: response[0].queryResult.parameters.fields.Correo.stringValue,
                priority: 1,
                status: 2,
                type: response[0].queryResult.parameters.fields.TipoTicket.stringValue,
                cc_emails: [
                    "ram@freshdesk.com",
                    "diana@freshdesk.com"]
            }


            var config = {
                headers: {
                    "content-Type": "application/json",
                    "Authorization": "Basic " + auth
                }
            }

            let ticketID = null;

            const res = await axios.post('https://ptree.freshdesk.com/api/v2/tickets', requestBody, config)
                .then(async function (response) {
                    console.log("Ticket levantado")
                    //console.log(response.data)
                    ticketID = response.data.id;
                    await twilioClient.messages.create({
                        from: to,
                        to: from,
                        body: `Se ha levantado exitosamente tu solicitud con el ID ${ticketID}.`
                    });
                })
                .catch(function (error) {
                    console.log(error);
                });
            //curl -v -u apikey:X -H "Content-Type: application/json" -X GET 'https://domain.freshdesk.com/api/v2/tickets'

        }

        let responseText = response[0].queryResult.fulfillmentText;
        // fake emi date and amount
        /* let dueDate = new Date();
        dueDate.setTime(dueDate.getTime() + 5 * 24 * 60 * 60 * 1000);
        let dueAmount = "$200"; */

        // respond to user
        await twilioClient.messages.create({
            from: to,
            to: from,
            //body: `Your next emi of ${dueAmount} is on ${dueDate.toDateString()}.`
            body: responseText
        });

        res.status(200).end();
        return
    }

    // forward dialogflow response to user
    /* const messages = response[0].queryResult.fulfillmentMessages;
    for (const message of messages) {
    
        // normal text message
        if (message.text) {
            await twilioClient.messages.create({
                from: to,
                to: from,
                body: message.text.text[0],
            });
        }
    } */

    // respond to twilio callback
    res.status(200).end();
});

// start server
app.listen(PORT, () => {
    //console.clear()
    console.log(`Listening on ${PORT}`);
});