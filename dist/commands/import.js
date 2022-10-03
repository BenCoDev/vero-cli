"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.importFromAirtable = void 0;
const chalk_1 = __importDefault(require("chalk"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const bottleneck_1 = __importDefault(require("bottleneck"));
const firestore_1 = require("firebase/firestore");
const storage_1 = require("firebase/storage");
const config_js_1 = __importDefault(require("../firebase/config.js"));
const node_fs_1 = require("node:fs");
const node_stream_1 = require("node:stream");
const node_util_1 = require("node:util");
const streamPipeline = (0, node_util_1.promisify)(node_stream_1.pipeline);
const db = (0, firestore_1.getFirestore)(config_js_1.default);
const storage = (0, storage_1.getStorage)(config_js_1.default);
const BASE_URL = 'https://api.airtable.com/v0/';
const APP_ID = 'apprFKqYQ3ej7lPsp';
const API_KEY = 'keyaRdPv6MbAqiXTv';
const SCREEN_DIMENSION = {
    width: 1280,
    height: 740,
};
const limiter = new bottleneck_1.default({
    minTime: 1000,
    maxConcurrent: 5, //maximum concurrent requests
});
const scheduleRequest = (recordId, tableName) => {
    return limiter.schedule(() => __awaiter(void 0, void 0, void 0, function* () {
        return yield getRecord(recordId, tableName);
    }));
};
const computeImagePosition = (position, imageDimension) => {
    let x, y, transformationRatio;
    let height = 740;
    let width = imageDimension.width * height / imageDimension.height;
    if (width <= SCREEN_DIMENSION.width) {
        transformationRatio = height / imageDimension.height;
    }
    else {
        width = SCREEN_DIMENSION.width;
        height = imageDimension.height * width / imageDimension.width;
        transformationRatio = width / imageDimension.width;
    }
    x = position.x * 1 / transformationRatio;
    y = position.y * 1 / transformationRatio;
    return {
        x,
        y,
    };
};
const listRecords = (tableName) => __awaiter(void 0, void 0, void 0, function* () {
    let allRecords = [];
    let offset = '';
    do {
        const result = yield _fetchRecords(tableName, offset);
        const records = result.records;
        offset = result.offset;
        allRecords.push(...records);
    } while (offset);
    console.log(chalk_1.default.green.bold(`Total number of records fetched: ${allRecords.length}`));
    return allRecords;
});
const _fetchRecords = (tableName, offset) => __awaiter(void 0, void 0, void 0, function* () {
    let url = BASE_URL + APP_ID + `/${tableName}` + `?api_key=${API_KEY}`;
    if (offset) {
        url += `&offset=${offset}`;
    }
    const result = yield (0, node_fetch_1.default)(url).then(response => {
        return response.json();
    }).catch(error => {
        console.log(chalk_1.default.red(`Error at fetching ${url}`));
        console.error(error);
    });
    return result;
});
const getRecord = (recordId, collectionName) => __awaiter(void 0, void 0, void 0, function* () {
    const url = BASE_URL + APP_ID + `/${collectionName}/${recordId}` + `?api_key=${API_KEY}`;
    const result = yield (0, node_fetch_1.default)(url).then(response => {
        return response.json();
    }).catch(error => {
        console.log(chalk_1.default.red(`Error at fetching ${url}`));
        console.error(error);
    });
    return result;
});
const upsert = (ref, data) => __awaiter(void 0, void 0, void 0, function* () {
    let addPromise;
    yield (0, firestore_1.updateDoc)(ref, data)
        .catch((e) => __awaiter(void 0, void 0, void 0, function* () {
        if (e.code === 'not-found') {
            console.log(chalk_1.default.yellow(`Document does not exist: will create ${ref.id}`));
            addPromise = (0, firestore_1.setDoc)(ref, data, { merge: true })
                .catch((e) => {
                throw e;
            });
        }
        else {
            throw e;
        }
    }));
    if (addPromise) {
        console.log(chalk_1.default.yellow(`Document will be created: ${ref.id}`));
        yield Promise.resolve(addPromise);
    }
});
const processPage = (pageAirtableData, pageRef) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    // 1. Add screenshot to storage
    const screenshot = pageAirtableData.page[0];
    const originalDimensions = {
        width: screenshot.width,
        height: screenshot.height,
    };
    const pageStorageRef = (0, storage_1.ref)(storage, `page/${screenshot.filename}`);
    const dlUrl = yield uploadToStorage(pageStorageRef, screenshot, {
        pageId: pageAirtableData.id,
    });
    // 2. Upsert to firestore
    yield Promise.resolve(upsert(pageRef, {
        name: pageAirtableData.name,
        screenshotUrlStorage: dlUrl,
        createdAt: firestore_1.Timestamp.fromDate(new Date(pageAirtableData.created_at)),
        originalDimensions: originalDimensions
    }));
    // 3. Get messages and add messages as subcollection
    let getAllMessagesPromises = [];
    (_a = pageAirtableData.roast_messages) === null || _a === void 0 ? void 0 : _a.map((messageId) => {
        getAllMessagesPromises.push(scheduleRequest(messageId, 'roast_messages'));
    });
    const getAllMessagesResults = yield Promise.all(getAllMessagesPromises);
    let processMessagePromises = [];
    getAllMessagesResults.map((messageResult, index) => {
        console.log(chalk_1.default.blue(`\tRecord #${index + 1}/${getAllMessagesResults.length}: messageId - ${messageResult.id}`));
        const messageRef = (0, firestore_1.doc)(db, `pages/${pageAirtableData.id}/messages`, messageResult.id);
        const messageData = Object.assign(Object.assign({ id: messageResult.id, pageId: pageAirtableData.id }, messageResult.fields), { position: computeImagePosition({
                x: messageResult.fields.x,
                y: messageResult.fields.y,
            }, originalDimensions) });
        processMessagePromises.push(processMessage(messageData, messageRef));
    });
    yield Promise.all(processMessagePromises);
});
const processMessage = (messageData, messageRef) => __awaiter(void 0, void 0, void 0, function* () {
    // 1. Add audio to storage
    const audioFile = messageData.audio_file[0];
    const fileType = audioFile.type.split('/')[1];
    const audioStorageRef = (0, storage_1.ref)(storage, `messages/${audioFile.id}.${fileType}`);
    const dlUrl = yield uploadToStorage(audioStorageRef, audioFile, {
        pageId: messageData.pageId,
        messageId: messageData.id
    });
    // 2. Upsert to firestore
    yield Promise.resolve(upsert(messageRef, {
        audioUrl: dlUrl,
        createdAt: firestore_1.Timestamp.fromDate(new Date(messageData.created_at)),
        position: messageData.position,
        textDescription: messageData.type,
    }));
});
const uploadToStorage = (storageRef, fileDescriptor, metadata) => __awaiter(void 0, void 0, void 0, function* () {
    const response = yield (0, node_fetch_1.default)(fileDescriptor.url);
    yield streamPipeline(response.body, (0, node_fs_1.createWriteStream)(fileDescriptor.id));
    const buffer = (0, node_fs_1.readFileSync)(fileDescriptor.id);
    const result = yield (0, storage_1.uploadBytes)(storageRef, buffer, {
        contentType: fileDescriptor.type,
        customMetadata: metadata,
    }).then((snapshot) => {
        return snapshot;
    }).catch((e) => {
        console.log(e);
        throw e;
    });
    const dlUrl = yield (0, storage_1.getDownloadURL)(result.ref);
    return dlUrl;
});
const importFromAirtable = () => __awaiter(void 0, void 0, void 0, function* () {
    console.log(chalk_1.default.blue("👋 Hey, we will import stuff from Airtable"));
    let allPages = yield listRecords('pages');
    // allPages = [allPages[2]];
    let processPagePromises = [];
    allPages.map((record, index) => {
        console.log(chalk_1.default.blue(`Record #${index + 1}/${allPages.length}: pageId - ${record.id}`));
        const pageRef = (0, firestore_1.doc)(db, 'pages', record.id);
        const airtablePageData = Object.assign({ id: record.id }, record.fields);
        processPagePromises.push(processPage(airtablePageData, pageRef));
    });
    const updateResults = yield Promise.all(processPagePromises);
    process.exit();
});
exports.importFromAirtable = importFromAirtable;
