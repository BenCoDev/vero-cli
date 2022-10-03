import chalk from "chalk";
import fetch from 'node-fetch';
import Bottleneck from 'bottleneck';
import {doc, updateDoc, getFirestore, setDoc, DocumentReference, Timestamp} from 'firebase/firestore';
import {getStorage, ref, uploadBytes, getDownloadURL, StorageReference} from 'firebase/storage';
import firebaseApp from '../firebase/config.js';

import {createWriteStream, readFileSync, unlink} from 'node:fs';
import {pipeline} from 'node:stream';
import {promisify} from 'node:util'

interface FileDescriptor {
  id: string;
  filename: string;
  url: string;
  type: string;
  size: number;
}
type Position = {
  x: number;
  y: number;
};
type Dimension = {
  width: number;
  height: number;
};

const streamPipeline = promisify(pipeline);

const db = getFirestore(firebaseApp);
const storage = getStorage(firebaseApp);

const BASE_URL: string = 'https://api.airtable.com/v0/';
const APP_ID: string = 'apprFKqYQ3ej7lPsp';
const API_KEY: string = 'keyaRdPv6MbAqiXTv';

const SCREEN_DIMENSION: Dimension = {
  width: 1280,
  height: 740,
};

const limiter = new Bottleneck({
  minTime: 1000, //minimum time between requests in ms
  maxConcurrent: 5, //maximum concurrent requests
});

const scheduleRequest = (recordId: string, tableName: string) => {
  return limiter.schedule(async ()=>{
    return await getRecord(recordId, tableName);
  })
}

const computeImagePosition = (position: Position, imageDimension: Dimension): Position => {
  let x, y, transformationRatio: number;

  let height: number = 740;
  let width: number = imageDimension.width * height / imageDimension.height;

  if (width <= SCREEN_DIMENSION.width) {
    transformationRatio = height / imageDimension.height;
  } else {
    width = SCREEN_DIMENSION.width;
    height = imageDimension.height * width / imageDimension.width;
    transformationRatio = width / imageDimension.width;
  }
  x = position.x * 1 / transformationRatio;
  y = position.y * 1 / transformationRatio;
  return {
    x,
    y,
  }
}

const listRecords = async (tableName: string) => {
  let allRecords: any = [];
  let offset: string = '';
  
  do {
    const result: any = await _fetchRecords(tableName, offset);
    const records = result.records;
    offset = result.offset;
    allRecords.push(...records);
  } while (offset)
  
  console.log(
    chalk.green.bold(`Total number of records fetched: ${allRecords.length}`),
  );

  return allRecords;
}

const _fetchRecords = async (tableName: string, offset: string): Promise<{offset: any, records: any}> => {
  let url = BASE_URL + APP_ID + `/${tableName}` + `?api_key=${API_KEY}`;
  if (offset) {
    url += `&offset=${offset}`;
  }
  
  const result = await fetch(url).then(response => {
    return response.json();
  }).catch(error => {
    console.log(chalk.red(`Error at fetching ${url}`));
    console.error(error)
  });

  return result;
}

const getRecord = async (recordId: string, collectionName: string) => {
  const url = BASE_URL + APP_ID + `/${collectionName}/${recordId}` + `?api_key=${API_KEY}`;

  const result = await fetch(url).then(response => {
    return response.json();
  }).catch(error => {
    console.log(chalk.red(`Error at fetching ${url}`));
    console.error(error)
  });

  return result;
}

const upsert = async (ref: DocumentReference, data: any): Promise<void> => {
  let addPromise;

  await updateDoc(ref, data)
    .catch(async (e) => {
      if (e.code === 'not-found') {
        console.log(chalk.yellow(`Document does not exist: will create ${ref.id}`));
        addPromise = setDoc(ref, data, { merge: true })
          .catch((e) => {
            throw e;
          });
      } else {
        throw e;
      }
    });

  if (addPromise) {
    console.log(chalk.yellow(`Document will be created: ${ref.id}`));
    await Promise.resolve(addPromise);
  }
}

const processPage = async (pageAirtableData: any, pageRef: DocumentReference): Promise<void> => {
  
  // 1. Add screenshot to storage
  const screenshot = pageAirtableData.page[0];
  const originalDimensions: Dimension = {
    width: screenshot.width,
    height: screenshot.height,
  };
  const pageStorageRef = ref(storage, `page/${screenshot.filename}`);
  const dlUrl = await uploadToStorage(pageStorageRef, screenshot, {
    pageId: pageAirtableData.id,
  });

  // 2. Upsert to firestore
  await Promise.resolve(upsert(pageRef, {
    name: pageAirtableData.name,
    screenshotUrlStorage: dlUrl,
    createdAt: Timestamp.fromDate(new Date(pageAirtableData.created_at)),
    originalDimensions: originalDimensions
  }));

  // 3. Get messages and add messages as subcollection
  let getAllMessagesPromises: Array<Promise<any>> = [];
  pageAirtableData.roast_messages?.map((messageId: string) => {
    getAllMessagesPromises.push(scheduleRequest(messageId, 'roast_messages'));
  })
  const getAllMessagesResults = await Promise.all(getAllMessagesPromises);

  let processMessagePromises: any = [];
  getAllMessagesResults.map((messageResult, index) => {
    console.log(chalk.blue(`\tRecord #${index+1}/${getAllMessagesResults.length}: messageId - ${messageResult.id}`));
    const messageRef = doc(db, `pages/${pageAirtableData.id}/messages`, messageResult.id);
    const messageData = {
      id: messageResult.id,
      pageId: pageAirtableData.id,
      ...messageResult.fields,
      position: computeImagePosition({
        x: messageResult.fields.x,
        y: messageResult.fields.y,
      }, originalDimensions),
    }

    processMessagePromises.push(processMessage(messageData, messageRef));
  });

  await Promise.all(processMessagePromises);
}

const processMessage = async (messageData: any, messageRef: DocumentReference): Promise<void> => {
  // 1. Add audio to storage
  const audioFile = messageData.audio_file[0];
  const fileType: string = audioFile.type.split('/')[1];

  const audioStorageRef = ref(storage, `messages/${audioFile.id}.${fileType}`);
  const dlUrl = await uploadToStorage(audioStorageRef, audioFile, {
    pageId: messageData.pageId,
    messageId: messageData.id
  });

  // 2. Upsert to firestore
  await Promise.resolve(upsert(messageRef, {
    audioUrl: dlUrl,
    createdAt: Timestamp.fromDate(new Date(messageData.created_at)),
    position: messageData.position,
    textDescription: messageData.type,
  }));
}

const uploadToStorage = async (storageRef: StorageReference, fileDescriptor: FileDescriptor, metadata: any): Promise<string> => {
  const response = await fetch(fileDescriptor.url)

  await streamPipeline(response.body, createWriteStream(fileDescriptor.id));
  
  const buffer = readFileSync(fileDescriptor.id);

  const result: any = await uploadBytes(storageRef, buffer, {
    contentType: fileDescriptor.type,
    customMetadata: metadata,
  }).then((snapshot) => {
    return snapshot;
  }).catch((e) => {
    console.log(e);
    throw e;
  });

  const dlUrl = await getDownloadURL(result.ref);

  return dlUrl;
}

export const importFromAirtable = async () => {
  console.log(chalk.blue("👋 Hey, we will import stuff from Airtable"));

  let allPages = await listRecords('pages');
  // allPages = [allPages[2]];

  
  let processPagePromises: Array<Promise<any>> = [];
  
  allPages.map((record: any, index: number) => {
    console.log(chalk.blue(`Record #${index+1}/${allPages.length}: pageId - ${record.id}`));
    
    const pageRef = doc(db, 'pages', record.id);
    const airtablePageData = {
      id: record.id,
      ...record.fields,
    }
    processPagePromises.push(processPage(airtablePageData, pageRef));

  });

  const updateResults = await Promise.all(processPagePromises)
  
  process.exit();
};
