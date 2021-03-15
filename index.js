const AWS = require('aws-sdk');
const util = require('util');
const s3 = new AWS.S3();
const { Pool } = require('pg');

const pool = new Pool({
  max: 1,
  min: 0,
  idleTimeoutMillis: 120000,
  connectionTimeoutMillis: 10000,
  host: process.env.PHOTOS_META_DB_HOST,
  user: process.env.PHOTOS_META_DB_USER,
  password: process.env.PHOTOS_META_DB_PASSWORD,
  port: process.env.PHOTOS_META_DB_PORT,
  database: process.env.PHOTOS_META_DB_NAME,
});

const outputPhotoPrefixes = ['_small', '_small@2x', '_large', '_large@2x'];
const outputFormats = ['avif', 'webp', 'jpeg'];

/* This is only run for delete events */
exports.handler = async (event) => {
  console.log('Reading options from event:\n', util.inspect(event, { depth: 5 }));
  const record = event.Records[0];
  const srcBucket = record.s3.bucket.name;
  const srcKey = record.s3.object.key;

  // Make sure the object being deleted is a file
  const typeMatch = srcKey.match(/\.([^.]*)$/);
  if (!typeMatch) {
    console.log('The file from event does not have an extension. May be a directory.');
    return;
  }

  const fileName = srcKey.match(/[^/]+$/g);
  const fileNameWithoutExt = fileName[0].replace(typeMatch[0], '');
  const dirWithoutFile = srcKey.replace(fileName, '');
  console.table([fileName, fileNameWithoutExt, dirWithoutFile]);

  // Delete any images from photos-resized that exist
  // There is no way to delete images with a prefix, so the same
  // prefixes that were used to create objects are stored here as well

  console.time(`deleting resized photos of ${fileNameWithoutExt}`);
  await s3
    .deleteObjects({
      Bucket: process.env.RESIZED_PHOTOS_BUCKET,
      Delete: {
        Objects: outputPhotoPrefixes
          .map((prefix) =>
            outputFormats.map((format) => ({
              Key: `${dirWithoutFile}${fileNameWithoutExt}${prefix}.${format}`,
            }))
          )
          .flat(1),
      },
    })
    .promise()
    .then((data) => console.log('successfully deleted photos ', data))
    .catch((err) => {
      console.error(err);
      return Promise.reject('could not delete photos');
    })
    .finally(() => console.timeEnd(`deleting resized photos of ${fileNameWithoutExt}`));

  const query = {
    text: 'DELETE FROM photos WHERE name=$1 and dir_path=$2',
    values: [fileNameWithoutExt, dirWithoutFile],
  };
  console.time('delete from db');

  await pool
    .query(query)
    .then((res) => console.log(res))
    .catch((err) => {
      console.error(err);
      return Promise.reject('failed to delete from db');
    })
    .finally(() => console.timeEnd('delete from db'));
  return Promise.resolve(
    `delete image ${fileNameWithoutExt} from resized bucket and from photos meta db`
  );
};
