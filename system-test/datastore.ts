// Copyright 2014 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as assert from 'assert';
import {readFileSync} from 'fs';
import * as path from 'path';
import {after, before, describe, it} from 'mocha';
import * as yaml from 'js-yaml';
import {Datastore, Index} from '../src';
import {google} from '../protos/protos';
import {Storage} from '@google-cloud/storage';
import {AggregateField} from '../src/aggregate';
import {PropertyFilter, EntityFilter, and, or} from '../src/filter';
import {entity} from '../src/entity';
import KEY_SYMBOL = entity.KEY_SYMBOL;
import {RunQueryOptions} from '../src/query';
import {v4 as uuidv4} from 'uuid';

describe('Datastore', () => {
  const testKinds: string[] = [];
  const datastore = new Datastore({
    namespace: `${Date.now()}`,
  });
  // Override the Key method so we can track what keys are created during the
  // tests. They are then deleted in the `after` hook.
  const key = datastore.key;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  datastore.key = function (options: any) {
    const keyObject = key.call(this, options);
    testKinds.push(keyObject.kind);
    return keyObject;
  };

  const {indexes: DECLARED_INDEXES} = yaml.load(
    readFileSync(path.join(__dirname, 'data', 'index.yaml'), 'utf8')
  ) as {indexes: google.datastore.admin.v1.IIndex[]};

  // TODO/DX ensure indexes before testing, and maybe? cleanup indexes after
  //  possible implications with kokoro project

  after(async () => {
    async function deleteEntities(kind: string) {
      const query = datastore.createQuery(kind).select('__key__');
      const [entities] = await datastore.runQuery(query);
      const keys = entities.map(entity => {
        return entity[datastore.KEY];
      });
      await datastore.delete(keys);
    }
    await Promise.all(testKinds.map(kind => deleteEntities(kind)));
  });

  it('should allocate IDs', async () => {
    const keys = await datastore.allocateIds(datastore.key('Kind'), 10);
    assert.ok(keys);
  });

  it('should get the project id', async () => {
    const projectId = await datastore.getProjectId();
    assert.notEqual(projectId, null);
  });

  describe('create, retrieve and delete', () => {
    const post = {
      title: 'How to make the perfect pizza in your grill',
      tags: ['pizza', 'grill'],
      publishedAt: new Date(),
      author: 'Silvano',
      isDraft: false,
      wordCount: 400,
      rating: 5.0,
      likes: null,
      metadata: {
        views: 100,
      },
    };

    it('should excludeFromIndexes correctly', async () => {
      const longString = Buffer.alloc(1501, '.').toString();
      const postKey = datastore.key(['Post', 'post1']);
      const data = {
        longString,
        notMetadata: true,
        longStringArray: [longString],
        metadata: {
          longString,
          otherProperty: 'value',
          obj: {
            longStringArray: [
              {
                longString,
                nestedLongStringArray: [
                  {
                    longString,
                    nestedProperty: true,
                  },
                  {
                    longString,
                  },
                ],
              },
            ],
          },
          longStringArray: [
            {
              longString,
              nestedLongStringArray: [
                {
                  longString,
                  nestedProperty: true,
                },
                {
                  longString,
                },
              ],
            },
          ],
        },
      };

      await datastore.save({
        key: postKey,
        data,
        excludeFromIndexes: [
          'longString',
          'longStringArray[]',
          'metadata.obj.longString',
          'metadata.obj.longStringArray[].longString',
          'metadata.obj.longStringArray[].nestedLongStringArray[].longString',
          'metadata.longString',
          'metadata.longStringArray[].longString',
          'metadata.longStringArray[].nestedLongStringArray[].longString',
        ],
      });
      const [entity] = await datastore.get(postKey);
      assert.deepStrictEqual(entity[datastore.KEY], postKey);
      delete entity[datastore.KEY];
      assert.deepStrictEqual(entity, data);
      await datastore.delete(postKey);
    });

    it('should remove index with using wildcard in excludeFromIndexes', async () => {
      const longString = Buffer.alloc(1501, '.').toString();
      const postKey = datastore.key(['Post', 'post3']);
      const data = {
        longString,
        notMetadata: true,
        longStringArray: [longString],
        metadata: {
          longString,
          otherProperty: 'value',
          obj: {
            longStringArray: [
              {
                longString,
                nestedLongStringArray: [
                  {
                    longString,
                    nestedProperty: true,
                  },
                  {
                    longString,
                  },
                ],
              },
            ],
          },
          longStringArray: [
            {
              longString,
              nestedLongStringArray: [
                {
                  longString,
                  nestedProperty: true,
                },
                {
                  longString,
                },
              ],
            },
          ],
        },
      };

      const excludeFromIndexes = [
        'longString',
        'longStringArray[]',
        'metadata.longString',
        'metadata.obj.*',
        'metadata.longStringArray[].*',
      ];

      await datastore.save({
        key: postKey,
        data,
        excludeFromIndexes,
      });
      const [entity] = await datastore.get(postKey);
      assert.deepStrictEqual(entity[datastore.KEY], postKey);
      delete entity[datastore.KEY];
      assert.deepStrictEqual(entity, data);
      await datastore.delete(postKey);
    });

    it('should auto remove index with excludeLargeProperties enabled', async () => {
      const longString = Buffer.alloc(1501, '.').toString();
      const postKey = datastore.key(['Post', 'post2']);
      const data = {
        longString,
        notMetadata: true,
        longStringArray: [longString],
        metadata: {
          longString,
          otherProperty: 'value',
          obj: {
            longStringArray: [
              {
                longString,
                nestedLongStringArray: [
                  {
                    longString,
                    nestedProperty: true,
                  },
                  {
                    longString,
                  },
                ],
              },
            ],
          },
          longStringArray: [
            {
              longString,
              nestedLongStringArray: [
                {
                  longString,
                  nestedProperty: true,
                },
                {
                  longString,
                },
              ],
            },
          ],
        },
      };

      await datastore.save({
        key: postKey,
        data,
        excludeLargeProperties: true,
      });
      const [entity] = await datastore.get(postKey);
      assert.deepStrictEqual(entity[datastore.KEY], postKey);
      delete entity[datastore.KEY];
      assert.deepStrictEqual(entity, data);
      await datastore.delete(postKey);
    });

    it('should accurately save/get a large int value via Datastore.int()', async () => {
      const postKey = datastore.key('Team');
      const largeIntValueAsString = '9223372036854775807';
      const points = Datastore.int(largeIntValueAsString);
      await datastore.save({key: postKey, data: {points}});
      const [entity] = await datastore.get(postKey, {wrapNumbers: true});
      assert.strictEqual(entity.points.value, largeIntValueAsString);
      assert.throws(() => entity.points.valueOf());
      await datastore.delete(postKey);
    });

    it('should wrap specified properties via IntegerTypeCastOptions.properties', async () => {
      const postKey = datastore.key('Scores');
      const largeIntValueAsString = '9223372036854775807';
      const panthers = Datastore.int(largeIntValueAsString);
      const broncos = 922337203;
      let integerTypeCastFunctionCalled = 0;
      await datastore.save({key: postKey, data: {panthers, broncos}});
      const [entity] = await datastore.get(postKey, {
        wrapNumbers: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          integerTypeCastFunction: (value: any) => {
            integerTypeCastFunctionCalled++;
            return value.toString();
          },
          properties: 'panthers',
        },
      });
      // verify that value of property 'panthers' was converted via 'integerTypeCastFunction'.
      assert.strictEqual(entity.panthers, largeIntValueAsString);
      assert.strictEqual(integerTypeCastFunctionCalled, 1);
      // verify that value of the property broncos was converted to int by default logic.
      assert.strictEqual(entity.broncos, broncos);
      await datastore.delete(postKey);
    });

    it('should save/get/delete with a key name', async () => {
      const postKey = datastore.key(['Post', 'post1']);
      await datastore.save({key: postKey, data: post});
      const [entity] = await datastore.get(postKey);
      assert.deepStrictEqual(entity[datastore.KEY], postKey);
      delete entity[datastore.KEY];
      assert.deepStrictEqual(entity, post);
      await datastore.delete(postKey);
    });

    it('should save/get/delete from a snapshot', async () => {
      function sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
      }
      const post2 = {
        title: 'Another way to make pizza',
        tags: ['pizza', 'grill'],
        publishedAt: new Date(),
        author: 'Silvano',
        isDraft: false,
        wordCount: 400,
        rating: 5.0,
        likes: null,
        metadata: {
          views: 100,
        },
      };
      const path = ['Post', 'post1'];
      const postKey = datastore.key(path);
      await datastore.save({key: postKey, data: post});
      await sleep(1000);
      const savedTime = Date.now();
      await sleep(1000);
      // Save new post2 data, but then verify the timestamp read has post1 data
      await datastore.save({key: postKey, data: post2});
      const [entity] = await datastore.get(postKey, {readTime: savedTime});
      assert.deepStrictEqual(entity[datastore.KEY], postKey);
      const [entityNoOptions] = await datastore.get(postKey);
      assert.deepStrictEqual(entityNoOptions[datastore.KEY], postKey);
      delete entity[datastore.KEY];
      assert.deepStrictEqual(entity, post);
      delete entityNoOptions[datastore.KEY];
      assert.deepStrictEqual(entityNoOptions, post2);
      await datastore.delete(postKey);
    });

    it('should save/get/delete with a numeric key id', async () => {
      const postKey = datastore.key(['Post', 123456789]);
      await datastore.save({key: postKey, data: post});
      const [entity] = await datastore.get(postKey);
      delete entity[datastore.KEY];
      assert.deepStrictEqual(entity, post);
      await datastore.delete(postKey);
    });

    it('should save/get/delete a buffer', async () => {
      const postKey = datastore.key(['Post']);
      const data = {
        buf: Buffer.from('010100000000000000000059400000000000006940', 'hex'),
      };
      await datastore.save({key: postKey, data});
      const assignedId = postKey.id;
      assert(assignedId);
      const [entity] = await datastore.get(postKey);
      delete entity[datastore.KEY];
      assert.deepStrictEqual(entity, data);
      await datastore.delete(datastore.key(['Post', assignedId as string]));
    });

    it('should save/get/delete an empty buffer', async () => {
      const postKey = datastore.key(['Post']);
      const data = {
        buf: Buffer.from([]),
      };
      await datastore.save({key: postKey, data});
      const assignedId = postKey.id;
      assert(assignedId);
      const [entity] = await datastore.get(postKey);
      delete entity[datastore.KEY];
      assert.deepStrictEqual(entity, data);
      await datastore.delete(datastore.key(['Post', assignedId as string]));
    });

    it('should save/get/delete with a generated key id', async () => {
      const postKey = datastore.key('Post');
      await datastore.save({key: postKey, data: post});

      // The key's path should now be complete.
      assert(postKey.id);

      const [entity] = await datastore.get(postKey);
      delete entity[datastore.KEY];
      assert.deepStrictEqual(entity, post);
      await datastore.delete(postKey);
    });

    it('should save/get/update', async () => {
      const postKey = datastore.key('Post');
      await datastore.save({key: postKey, data: post});
      const [entity] = await datastore.get(postKey);
      assert.strictEqual(entity.title, post.title);
      entity.title = 'Updated';
      await datastore.save(entity);
      const [entity2] = await datastore.get(postKey);
      assert.strictEqual(entity2.title, 'Updated');
      await datastore.delete(postKey);
    });

    it('should save/get/merge', async () => {
      const postKey = datastore.key(['Post', 1]);
      const originalData = {
        key: postKey,
        data: {
          title: 'Original',
          status: 'neat',
        },
      };
      await datastore.save(originalData);
      const updatedData = {
        key: postKey,
        data: {
          title: 'Updated',
        },
      };
      await datastore.merge(updatedData);
      const [entity] = await datastore.get(postKey);
      assert.strictEqual(entity.title, updatedData.data.title);
      assert.strictEqual(entity.status, originalData.data.status);
      await datastore.delete(postKey);
    });

    it('should save and get with a string ID', async () => {
      const longIdKey = datastore.key([
        'Post',
        datastore.int('100000000000001234'),
      ]);
      await datastore.save({
        key: longIdKey,
        data: {
          test: true,
        },
      });
      const [entity] = await datastore.get(longIdKey);
      assert.strictEqual(entity.test, true);
    });

    it('should fail explicitly set second insert on save', async () => {
      const postKey = datastore.key('Post');
      await datastore.save({key: postKey, data: post});

      // The key's path should now be complete.
      assert(postKey.id);
      await assert.rejects(
        datastore.save({
          key: postKey,
          method: 'insert',
          data: post,
        })
      );
      const [entity] = await datastore.get(postKey);
      delete entity[datastore.KEY];
      assert.deepStrictEqual(entity, post);
      await datastore.delete(postKey);
    });

    it('should fail explicitly set first update on save', async () => {
      const postKey = datastore.key('Post');
      await assert.rejects(
        datastore.save({
          key: postKey,
          method: 'update',
          data: post,
        })
      );
    });

    it('should save/get/delete multiple entities at once', async () => {
      const post2 = {
        title: 'How to make the perfect homemade pasta',
        tags: ['pasta', 'homemade'],
        publishedAt: new Date('2001-01-01T00:00:00.000Z'),
        author: 'Silvano',
        isDraft: false,
        wordCount: 450,
        rating: 4.5,
      };
      const key1 = datastore.key('Post');
      const key2 = datastore.key('Post');
      await datastore.save([
        {key: key1, data: post},
        {key: key2, data: post2},
      ]);
      const [entities] = await datastore.get([key1, key2]);
      assert.strictEqual(entities.length, 2);
      await datastore.delete([key1, key2]);
    });

    it('should get multiple entities in a stream', done => {
      const key1 = datastore.key('Post');
      const key2 = datastore.key('Post');

      datastore.save(
        [
          {key: key1, data: post},
          {key: key2, data: post},
        ],
        err => {
          assert.ifError(err);

          let numEntitiesEmitted = 0;

          datastore
            .createReadStream([key1, key2])
            .on('error', done)
            .on('data', () => {
              numEntitiesEmitted++;
            })
            .on('end', () => {
              assert.strictEqual(numEntitiesEmitted, 2);
              datastore.delete([key1, key2], done);
            });
        }
      );
    });

    it('should save keys as a part of entity and query by key', async () => {
      const personKey = datastore.key(['People', 'US', 'Person', 'name']);
      await datastore.save({
        key: personKey,
        data: {
          fullName: 'Full name',
          linkedTo: personKey, // himself
        },
      });
      const query = datastore
        .createQuery('Person')
        .hasAncestor(datastore.key(['People', 'US']))
        .filter('linkedTo', personKey);
      const [results] = await datastore.runQuery(query);
      assert.strictEqual(results![0].fullName, 'Full name');
      assert.deepStrictEqual(results![0].linkedTo, personKey);
      await datastore.delete(personKey);
    });

    it('should save with an empty buffer', async () => {
      const key = datastore.key(['TEST']);
      const result = await datastore.save({
        key: key,
        data: {
          name: 'test',
          blob: Buffer.from([]),
        },
      });
      const mutationResult = result.pop()?.mutationResults?.pop();
      assert.strictEqual(mutationResult?.key?.path?.pop()?.kind, 'TEST');
    });

    describe('entity types', () => {
      it('should save and decode an int', async () => {
        const integerValue = 2015;
        const integerType = Datastore.int(integerValue);
        const key = datastore.key('Person');
        await datastore.save({
          key,
          data: {
            year: integerType,
          },
        });
        const [entity] = await datastore.get(key);
        assert.strictEqual(entity.year, integerValue);
      });

      it('should save and decode a double', async () => {
        const doubleValue = 99.99;
        const doubleType = Datastore.double(doubleValue);
        const key = datastore.key('Person');
        await datastore.save({
          key,
          data: {
            nines: doubleType,
          },
        });
        const [entity] = await datastore.get(key);
        assert.strictEqual(entity.nines, doubleValue);
      });

      it('should save and decode a geo point', async () => {
        const geoPointValue = {
          latitude: 40.6894,
          longitude: -74.0447,
        };
        const geoPointType = Datastore.geoPoint(geoPointValue);
        const key = datastore.key('Person');
        await datastore.save({
          key,
          data: {
            location: geoPointType,
          },
        });
        const [entity] = await datastore.get(key);
        assert.deepStrictEqual(entity.location, geoPointValue);
      });
    });
  });

  describe('querying the datastore', () => {
    const ancestor = datastore.key(['Book', 'GoT']);

    const keys = [
      // Paths:
      ['Rickard'],
      ['Rickard', 'Character', 'Eddard'],
      ['Catelyn'],
      ['Rickard', 'Character', 'Eddard', 'Character', 'Arya'],
      ['Rickard', 'Character', 'Eddard', 'Character', 'Sansa'],
      ['Rickard', 'Character', 'Eddard', 'Character', 'Robb'],
      ['Rickard', 'Character', 'Eddard', 'Character', 'Bran'],
      ['Rickard', 'Character', 'Eddard', 'Character', 'Jon Snow'],
    ].map(path => {
      return datastore.key(['Book', 'GoT', 'Character'].concat(path));
    });

    const characters = [
      {
        name: 'Rickard',
        family: 'Stark',
        appearances: 9,
        alive: false,
      },
      {
        name: 'Eddard',
        family: 'Stark',
        appearances: 9,
        alive: false,
      },
      {
        name: 'Catelyn',
        family: ['Stark', 'Tully'],
        appearances: 26,
        alive: false,
      },
      {
        name: 'Arya',
        family: 'Stark',
        appearances: 33,
        alive: true,
      },
      {
        name: 'Sansa',
        family: 'Stark',
        appearances: 31,
        alive: true,
      },
      {
        name: 'Robb',
        family: 'Stark',
        appearances: 22,
        alive: false,
      },
      {
        name: 'Bran',
        family: 'Stark',
        appearances: 25,
        alive: true,
      },
      {
        name: 'Jon Snow',
        family: 'Stark',
        appearances: 32,
        alive: true,
      },
    ];

    before(async () => {
      const keysToSave = keys.map((key, index) => {
        return {
          key,
          data: characters[index],
        };
      });
      await datastore.save(keysToSave);
    });

    after(async () => {
      await datastore.delete(keys);
    });

    it('should limit queries', async () => {
      const q = datastore
        .createQuery('Character')
        .hasAncestor(ancestor)
        .limit(5);
      const [firstEntities, info] = await datastore.runQuery(q);
      assert.strictEqual(firstEntities!.length, 5);
      const secondQ = datastore
        .createQuery('Character')
        .hasAncestor(ancestor)
        .start(info!.endCursor!);
      const [secondEntities] = await datastore.runQuery(secondQ);
      assert.strictEqual(secondEntities!.length, 3);
    });

    it('should not go over a limit', async () => {
      const limit = 3;
      const q = datastore
        .createQuery('Character')
        .hasAncestor(ancestor)
        .limit(limit);
      const [results] = await datastore.runQuery(q);
      assert.strictEqual(results!.length, limit);
    });

    it('should run a query as a stream', done => {
      const q = datastore.createQuery('Character').hasAncestor(ancestor);
      let resultsReturned = 0;
      datastore
        .runQueryStream(q)
        .on('error', done)
        .on('data', () => resultsReturned++)
        .on('end', () => {
          assert.strictEqual(resultsReturned, characters.length);
          done();
        });
    });

    it('should run a datastore query as a stream via query#runStream', done => {
      const q = datastore.createQuery('Character').hasAncestor(ancestor);
      let resultsReturned = 0;
      q.runStream()
        .on('error', done)
        .on('data', () => resultsReturned++)
        .on('end', () => {
          assert.strictEqual(resultsReturned, characters.length);
          done();
        });
    });

    it('should run a transaction query as a stream via query#runStream', done => {
      const transaction = datastore.transaction();
      const q = transaction.createQuery('Character').hasAncestor(ancestor);
      let resultsReturned = 0;
      q.runStream()
        .on('error', done)
        .on('data', () => resultsReturned++)
        .on('end', () => {
          assert.strictEqual(resultsReturned, characters.length);
          done();
        });
    });

    it('should not go over a limit with a stream', done => {
      const limit = 3;
      const q = datastore
        .createQuery('Character')
        .hasAncestor(ancestor)
        .limit(limit);
      let resultsReturned = 0;
      datastore
        .runQueryStream(q)
        .on('error', done)
        .on('data', () => resultsReturned++)
        .on('end', () => {
          assert.strictEqual(resultsReturned, limit);
          done();
        });
    });

    it('should filter queries with simple indexes', async () => {
      const q = datastore
        .createQuery('Character')
        .hasAncestor(ancestor)
        .filter('appearances', '>=', 20);
      const [entities] = await datastore.runQuery(q);
      assert.strictEqual(entities!.length, 6);
    });

    it('should filter queries with NOT_EQUAL', async () => {
      const q = datastore
        .createQuery('Character')
        .hasAncestor(ancestor)
        .filter('appearances', '!=', 9);
      const [entities] = await datastore.runQuery(q);
      assert.strictEqual(entities!.length, 6);
    });

    it('should filter queries with IN', async () => {
      const q = datastore
        .createQuery('Character')
        .hasAncestor(ancestor)
        .filter('appearances', 'IN', [9, 25]);
      const [entities] = await datastore.runQuery(q);
      assert.strictEqual(entities!.length, 3);
    });

    it('should filter queries with __key__ and IN', async () => {
      const key1 = datastore.key(['Book', 'GoT', 'Character', 'Rickard']);
      const key2 = datastore.key([
        'Book',
        'GoT',
        'Character',
        'Rickard',
        'Character',
        'Eddard',
        'Character',
        'Sansa',
      ]);
      const key3 = datastore.key([
        'Book',
        'GoT',
        'Character',
        'Rickard',
        'Character',
        'Eddard',
      ]);
      const value = [key1, key2, key3];
      const q = datastore
        .createQuery('Character')
        .hasAncestor(ancestor)
        .filter('__key__', 'IN', value);
      const [entities] = await datastore.runQuery(q);
      assert.strictEqual(entities!.length, 3);
      assert.deepStrictEqual(entities[0][KEY_SYMBOL], key1);
      assert.deepStrictEqual(entities[1][KEY_SYMBOL], key3);
      assert.deepStrictEqual(entities[2][KEY_SYMBOL], key2);
    });

    it('should filter queries with NOT_IN', async () => {
      const q = datastore
        .createQuery('Character')
        .hasAncestor(ancestor)
        .filter('appearances', 'NOT_IN', [9, 25]);
      const [entities] = await datastore.runQuery(q);
      assert.strictEqual(entities!.length, 5);
    });

    it('should filter queries with defined indexes', async () => {
      const q = datastore
        .createQuery('Character')
        .hasAncestor(ancestor)
        .filter('family', 'Stark')
        .filter('appearances', '>=', 20);
      const [entities] = await datastore.runQuery(q);
      assert.strictEqual(entities!.length, 6);
    });
    describe('with the filter function using the Filter class', () => {
      it('should run a query with one property filter', async () => {
        const filter = new PropertyFilter('family', '=', 'Stark');
        const q = datastore
          .createQuery('Character')
          .filter(filter)
          .hasAncestor(ancestor);
        const [entities] = await datastore.runQuery(q);
        assert.strictEqual(entities!.length, 8);
      });
      it('should run a query with two property filters', async () => {
        const q = datastore
          .createQuery('Character')
          .filter(new PropertyFilter('family', '=', 'Stark'))
          .filter(new PropertyFilter('appearances', '>=', 20));
        const [entities] = await datastore.runQuery(q);
        assert.strictEqual(entities!.length, 6);
      });
      it('should run a query using new Filter class with filter', async () => {
        const q = datastore
          .createQuery('Character')
          .filter('family', 'Stark')
          .filter(new PropertyFilter('appearances', '>=', 20));
        const [entities] = await datastore.runQuery(q);
        assert.strictEqual(entities!.length, 6);
        for (const entity of entities) {
          if (Array.isArray(entity.family)) {
            assert.strictEqual(entity.family[0], 'Stark');
          } else {
            assert.strictEqual(entity.family, 'Stark');
          }
          assert(entity.appearances >= 20);
        }
      });
      it('should run a query using an AND composite filter', async () => {
        const q = datastore
          .createQuery('Character')
          .filter(
            and([
              new PropertyFilter('family', '=', 'Stark'),
              new PropertyFilter('appearances', '>=', 20),
            ])
          );
        const [entities] = await datastore.runQuery(q);
        assert.strictEqual(entities!.length, 6);
        for (const entity of entities) {
          if (Array.isArray(entity.family)) {
            assert.strictEqual(entity.family[0], 'Stark');
          } else {
            assert.strictEqual(entity.family, 'Stark');
          }
          assert(entity.appearances >= 20);
        }
      });
      it('should run a query using an OR composite filter', async () => {
        const q = datastore
          .createQuery('Character')
          .filter(
            or([
              new PropertyFilter('family', '=', 'Stark'),
              new PropertyFilter('appearances', '>=', 20),
            ])
          );
        const [entities] = await datastore.runQuery(q);
        assert.strictEqual(entities!.length, 8);
        let atLeastOne = false;
        for (const entity of entities) {
          const familyHasStark = Array.isArray(entity.family)
            ? entity.family[0] === 'Stark'
            : entity.family === 'Stark';
          const hasEnoughAppearances = entity.appearances >= 20;
          if (familyHasStark && !hasEnoughAppearances) {
            atLeastOne = true;
          }
        }
        assert(atLeastOne);
      });
      describe('using hasAncestor and Filter class', () => {
        const secondAncestor = datastore.key([
          'Book',
          'GoT',
          'Character',
          'Rickard',
          'Character',
          'Eddard',
        ]);
        it('should run a query using hasAncestor last', async () => {
          const q = datastore
            .createQuery('Character')
            .filter(new PropertyFilter('appearances', '<', 30))
            .hasAncestor(secondAncestor);
          const [entities] = await datastore.runQuery(q);
          assert.strictEqual(entities!.length, 3);
        });
        it('should run a query using hasAncestor first', async () => {
          const q = datastore
            .createQuery('Character')
            .hasAncestor(secondAncestor)
            .filter(new PropertyFilter('appearances', '<', 30));
          const [entities] = await datastore.runQuery(q);
          assert.strictEqual(entities!.length, 3);
        });
      });
    });
    describe('with a count filter', () => {
      it('should run a count aggregation', async () => {
        const q = datastore.createQuery('Character');
        const aggregate = datastore
          .createAggregationQuery(q)
          .addAggregation(AggregateField.count());
        const [results] = await datastore.runAggregationQuery(aggregate);
        assert.deepStrictEqual(results, [{property_1: 8}]);
      });
      it('should run a count aggregation with a list of aggregates', async () => {
        const q = datastore.createQuery('Character');
        const aggregate = datastore
          .createAggregationQuery(q)
          .addAggregations([AggregateField.count(), AggregateField.count()]);
        const [results] = await datastore.runAggregationQuery(aggregate);
        assert.deepStrictEqual(results, [{property_1: 8, property_2: 8}]);
      });
      it('should run a count aggregation having other filters', async () => {
        const q = datastore
          .createQuery('Character')
          .filter('family', 'Stark')
          .filter('appearances', '>=', 20);
        const aggregate = datastore
          .createAggregationQuery(q)
          .addAggregation(AggregateField.count().alias('total'));
        const [results] = await datastore.runAggregationQuery(aggregate);
        assert.deepStrictEqual(results, [{total: 6}]);
      });
      it('should run a count aggregate filter with an alias', async () => {
        const q = datastore.createQuery('Character');
        const aggregate = datastore
          .createAggregationQuery(q)
          .addAggregation(AggregateField.count().alias('total'));
        const [results] = await datastore.runAggregationQuery(aggregate);
        assert.deepStrictEqual(results, [{total: 8}]);
      });
      it('should do multiple count aggregations with aliases', async () => {
        const q = datastore.createQuery('Character');
        const aggregate = datastore
          .createAggregationQuery(q)
          .addAggregations([
            AggregateField.count().alias('total'),
            AggregateField.count().alias('total2'),
          ]);
        const [results] = await datastore.runAggregationQuery(aggregate);
        assert.deepStrictEqual(results, [{total: 8, total2: 8}]);
      });
      it('should run a count aggregation filter with a limit', async () => {
        const q = datastore.createQuery('Character').limit(5);
        const aggregate = datastore
          .createAggregationQuery(q)
          .addAggregation(AggregateField.count());
        const [results] = await datastore.runAggregationQuery(aggregate);
        assert.deepStrictEqual(results, [{property_1: 5}]);
      });
      it('should run a count aggregate filter with a limit and an alias', async () => {
        const q = datastore.createQuery('Character').limit(7);
        const aggregate = datastore
          .createAggregationQuery(q)
          .addAggregations([AggregateField.count().alias('total')]);
        const [results] = await datastore.runAggregationQuery(aggregate);
        assert.deepStrictEqual(results, [{total: 7}]);
      });
    });
    it('should filter by ancestor', async () => {
      const q = datastore.createQuery('Character').hasAncestor(ancestor);
      const [entities] = await datastore.runQuery(q);
      assert.strictEqual(entities.length, characters.length);
    });

    it('should construct filters by null status', async () => {
      assert.strictEqual(
        datastore.createQuery('Character').filter('status', null).filters.pop()
          ?.val,
        null
      );
      assert.strictEqual(
        datastore
          .createQuery('Character')
          .filter('status', '=', null)
          .filters.pop()?.val,
        null
      );
    });
    it('should filter by key', async () => {
      const key = datastore.key(['Book', 'GoT', 'Character', 'Rickard']);
      const q = datastore
        .createQuery('Character')
        .hasAncestor(ancestor)
        .filter('__key__', key);
      const [entities] = await datastore.runQuery(q);
      assert.strictEqual(entities!.length, 1);
    });

    it('should order queries', async () => {
      const q = datastore
        .createQuery('Character')
        .hasAncestor(ancestor)
        .order('appearances');

      const [entities] = await datastore.runQuery(q);
      assert.strictEqual(entities![0].name, characters[0].name);
      assert.strictEqual(entities![7].name, characters[3].name);
    });

    it('should select projections', async () => {
      const q = datastore
        .createQuery('Character')
        .hasAncestor(ancestor)
        .select(['name', 'family']);

      const [entities] = await datastore.runQuery(q);
      delete entities[0][datastore.KEY];
      assert.deepStrictEqual(entities![0], {
        name: 'Arya',
        family: 'Stark',
      });
      delete entities[8][datastore.KEY];
      assert.deepStrictEqual(entities![8], {
        name: 'Sansa',
        family: 'Stark',
      });
    });

    it('should paginate with offset and limit', async () => {
      const q = datastore
        .createQuery('Character')
        .hasAncestor(ancestor)
        .offset(2)
        .limit(3)
        .order('appearances');

      const [entities, info] = await datastore.runQuery(q);
      assert.strictEqual(entities!.length, 3);
      assert.strictEqual(entities![0].name, 'Robb');
      assert.strictEqual(entities![2].name, 'Catelyn');
      const secondQ = datastore
        .createQuery('Character')
        .hasAncestor(ancestor)
        .order('appearances')
        .start(info!.endCursor!);
      const [secondEntities] = await datastore.runQuery(secondQ);
      assert.strictEqual(secondEntities!.length, 3);
      assert.strictEqual(secondEntities![0].name, 'Sansa');
      assert.strictEqual(secondEntities![2].name, 'Arya');
    });

    it('should resume from a start cursor', async () => {
      const q = datastore
        .createQuery('Character')
        .hasAncestor(ancestor)
        .offset(2)
        .limit(2)
        .order('appearances');
      const [, info] = await datastore.runQuery(q);
      const secondQ = datastore
        .createQuery('Character')
        .hasAncestor(ancestor)
        .order('appearances')
        .start(info!.endCursor!);
      const [secondEntities] = await datastore.runQuery(secondQ);
      assert.strictEqual(secondEntities!.length, 4);
      assert.strictEqual(secondEntities![0].name, 'Catelyn');
      assert.strictEqual(secondEntities![3].name, 'Arya');
    });

    it('should group queries', async () => {
      const q = datastore
        .createQuery('Character')
        .hasAncestor(ancestor)
        .groupBy('appearances');
      const [entities] = await datastore.runQuery(q);
      assert.strictEqual(entities!.length, characters.length - 1);
    });

    it('should query from the Query object', async () => {
      await datastore.createQuery('Character').run();
    });
  });

  describe('transactions', () => {
    it('should run in a transaction', async () => {
      /*
      2c30626d18eca5fffd28214cebfe2ce4370353fe
      Before begin transaction: 0
      After begin transaction: 3068
      After fetch: 3174
      After save: 3174
      After commit: 3290
       */
      const key = datastore.key(['Company', 'Google']);
      const obj = {
        url: 'www.google.com',
      };
      const transaction = datastore.transaction();
      const startTime = new Date().getTime();
      function printTimeElasped(label: string) {
        console.log(`${label}: ${new Date().getTime() - startTime}`);
      }
      printTimeElasped('Before begin transaction');
      await transaction.run();
      printTimeElasped('After begin transaction');
      await transaction.get(key);
      printTimeElasped('After fetch');
      transaction.save({key, data: obj});
      printTimeElasped('After save');
      const committedResults = await transaction.commit();
      printTimeElasped('After commit');
      const [entity] = await datastore.get(key);
      delete entity[datastore.KEY];
      assert.deepStrictEqual(entity, obj);
    });

    it('should run without begin transaction in a transaction', async () => {
      /*
      2c30626d18eca5fffd28214cebfe2ce4370353fe
      Before begin transaction: 0
      After begin transaction: 1
      After fetch: 3105
      After save: 3105
      After commit: 3324
       */
      const key = datastore.key(['Company', 'Google']);
      const obj = {
        url: 'www.google.com.sample',
      };
      const transaction = datastore.transaction();
      const startTime = new Date().getTime();
      function printTimeElasped(label: string) {
        console.log(`${label}: ${new Date().getTime() - startTime}`);
      }
      printTimeElasped('Before begin transaction');
      printTimeElasped('After begin transaction');
      await transaction.get(key);
      printTimeElasped('After fetch');
      transaction.save({key, data: obj});
      printTimeElasped('After save');
      const committedResults = await transaction.commit();
      printTimeElasped('After commit');
      const [entity] = await datastore.get(key);
      delete entity[datastore.KEY];
      assert.deepStrictEqual(entity, obj);
    });

    it('should observe a save because omitting `run` results in a save anyway', async () => {
      // First delete the entity
      const key = datastore.key(['Company', 'Google']);
      const obj = {
        url: 'www.google.com.sample',
      };
      await datastore.delete(key);
      const [entity1] = await datastore.get(key);
      assert.deepStrictEqual(entity1, undefined);
      // Next run a transaction without running transaction.run()
      const transaction = datastore.transaction();
      const startTime = new Date().getTime();
      function printTimeElasped(label: string) {
        console.log(`${label}: ${new Date().getTime() - startTime}`);
      }
      printTimeElasped('Before begin transaction');
      printTimeElasped('After begin transaction');
      transaction.save({key, data: obj});
      printTimeElasped('After save');
      const committedResults = await transaction.commit();
      printTimeElasped('After commit');
      // Compare the results and observe that a save occurred
      const [transactionEntity] = await transaction.get(key);
      printTimeElasped('After fetch');
      const [entity] = await datastore.get(key);
      delete entity[datastore.KEY];
      delete transactionEntity[datastore.KEY];
      assert.deepStrictEqual(transactionEntity, obj);
      assert.deepStrictEqual(entity, obj);
    });

    it('should use readTime from the query options', async () => {
      // TODO: Should use readTime from the query options
      // TODO: If query options are omitted then should use readTime from the readOnly options
      // First delete the entity
      function sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
      }
      const key = datastore.key(['Company', 'Google']);
      const obj = {
        url: 'www.google.com.sample',
      };
      await datastore.delete(key);
      const [entity1] = await datastore.get(key);
      assert.deepStrictEqual(entity1, undefined);
      // Next run a transaction without running transaction.run()
      const transaction = datastore.transaction();
      const startTime = new Date().getTime();
      function printTimeElasped(label: string) {
        console.log(`${label}: ${new Date().getTime() - startTime}`);
      }
      const beforeWrite = new Date().getTime();
      // const otherTime = Date.now();
      await sleep(2000);
      await datastore.save({key, data: obj});
      await sleep(2000);
      const afterWrite = new Date().getTime();
      const options = {
        newTransaction: {
          readOnly: {
            readTime: {
              seconds: Math.floor(beforeWrite / 1000),
            },
          },
        },
        // readTime: beforeWrite,
      };
      /*
      const options = {
        readTime: afterWrite,
      };
      */
      // const options = undefined;
      printTimeElasped('Before begin transaction');
      const transactionEntityGet = await transaction.get(key, options);
      assert.deepStrictEqual(transactionEntityGet[0], undefined);
      printTimeElasped('After begin transaction');
      transaction.save({key, data: obj});
      printTimeElasped('After save');
      const committedResults = await transaction.commit();
      printTimeElasped('After commit');
      // Compare the results and observe that a save occurred
      const [transactionEntity] = await transaction.get(key);
      printTimeElasped('After fetch');
      const [entity] = await datastore.get(key);
      delete entity[datastore.KEY];
      delete transactionEntity[datastore.KEY];
      assert.deepStrictEqual(transactionEntity, obj);
      assert.deepStrictEqual(entity, obj);
    });

    it('should run without begin transaction and new transaction options', async () => {
      /*
      Before begin transaction: 0
      After begin transaction: 0
      After fetch: 2928
      After save: 2929
      After commit: 3140
      */
      const key = datastore.key(['Company', 'Google']);
      const obj = {
        url: 'www.google.com',
      };
      const transaction = datastore.transaction();
      const startTime = new Date().getTime();
      function printTimeElasped(label: string) {
        console.log(`${label}: ${new Date().getTime() - startTime}`);
      }
      const options = {
        newTransaction: {},
      };
      printTimeElasped('Before begin transaction');
      printTimeElasped('After begin transaction');
      await transaction.get(key, options);
      printTimeElasped('After fetch');
      transaction.save({key, data: obj});
      printTimeElasped('After save');
      const committedResults = await transaction.commit();
      printTimeElasped('After commit');
      const [entity] = await datastore.get(key);
      delete entity[datastore.KEY];
      assert.deepStrictEqual(entity, obj);
    });

    it('should just pass in a transaction id and use that as the transaction id', async () => {
      // This actually results in an invalid transaction
      const id = 'sample'; // uuidv4();
      const key = datastore.key(['Company', 'Google']);
      const obj = {
        url: 'www.google.com',
      };
      const transaction = datastore.transaction({id});
      const startTime = new Date().getTime();
      function printTimeElasped(label: string) {
        console.log(`${label}: ${new Date().getTime() - startTime}`);
      }
      printTimeElasped('Before begin transaction');
      printTimeElasped('After begin transaction');
      const value = await transaction.get(key);
      printTimeElasped('After fetch');
      transaction.save({key, data: obj});
      printTimeElasped('After save');
      const committedResults = await transaction.commit();
      printTimeElasped('After commit');
      const [entity] = await datastore.get(key);
      delete entity[datastore.KEY];
      assert.deepStrictEqual(entity, obj);
    });

    it('should run without begin transaction and also new transaction with previous txn that doesnt exist yet', async () => {
      /*
      2c30626d18eca5fffd28214cebfe2ce4370353fe
      Before begin transaction: 0
      After begin transaction: 1
      Error: 3 INVALID_ARGUMENT: Invalid transaction.
      */
      console.log('define key');
      const key = datastore.key(['Company', 'Google']);
      console.log('define obj');
      const obj = {
        url: 'www.google.com',
      };
      console.log('define transaction');
      const transaction = datastore.transaction();
      console.log('start time');
      const startTime = new Date().getTime();
      function printTimeElasped(label: string) {
        console.log(`${label}: ${new Date().getTime() - startTime}`);
      }
      console.log('options');
      const options = {
        newTransaction: {
          readWrite: {
            previousTransaction: Buffer.from('734'),
          },
        },
      };
      // const options = {};
      printTimeElasped('Before begin transaction');
      printTimeElasped('After begin transaction');
      await transaction.get(key, options);
      printTimeElasped('After fetch');
      const committedResults = await transaction.commit();
      printTimeElasped('After commit');
      const [entity] = await datastore.get(key);
      // delete entity[datastore.KEY];
      assert.deepStrictEqual(entity, obj);
    });

    it('should run two transactions in a row', async () => {
      /*
        24cc5967ecd2fe3809a33fdf81b4852893b87885
        Before begin transaction: 0
        After begin transaction: 3001
        After fetch: 3108
        After save: 3109
        After commit: 3221
        Before begin transaction: 3306
        After begin transaction: 3306
        After fetch: 3419
        After commit: 3478
       */
      const key = datastore.key(['Company', 'Google']);
      const obj = {
        url: 'www.google.com',
      };
      // First do a transaction so that we have an id to provide in the next transaction
      const transaction1 = datastore.transaction();
      const startTime = new Date().getTime();
      function printTimeElasped(label: string) {
        console.log(`${label}: ${new Date().getTime() - startTime}`);
      }
      printTimeElasped('Before begin transaction');
      await transaction1.run();
      printTimeElasped('After begin transaction');
      await transaction1.get(key);
      printTimeElasped('After fetch');
      transaction1.save({key, data: obj});
      printTimeElasped('After save');
      const committedResults1 = await transaction1.commit();
      printTimeElasped('After commit');
      const [entity1] = await datastore.get(key);
      delete entity1[datastore.KEY];
      // Do a second transaction where we provide the id from the first transaction in the second transaction
      const transaction = datastore.transaction();
      printTimeElasped('Before begin transaction');
      printTimeElasped('After begin transaction');
      await transaction.get(key);
      printTimeElasped('After fetch');
      const committedResults = await transaction.commit();
      printTimeElasped('After commit');
      const [entity] = await datastore.get(key);
      // delete entity[datastore.KEY];
      // assert.deepStrictEqual(entity, obj);
    });

    it('should run without begin transaction and also new transaction with an existing transaction', async () => {
      /*
      2c30626d18eca5fffd28214cebfe2ce4370353fe
      Before begin transaction: 0
      After begin transaction: 3102
      After fetch: 3362
      After save: 3362
      After commit: 3471
      Before begin transaction: 3572
      After begin transaction: 3572
      After fetch: 3671
      After commit: 3787
      24cc5967ecd2fe3809a33fdf81b4852893b87885
      Before begin transaction: 0
      After begin transaction: 3176
      After fetch: 3271
      After save: 3271
      After commit: 3387
      Before begin transaction: 3488
      After begin transaction: 3488
      After fetch: 3602
      After commit: 3684
      */
      const key = datastore.key(['Company', 'Google']);
      const obj = {
        url: 'www.google.com',
      };
      // First do a transaction so that we have an id to provide in the next transaction
      const transaction1 = datastore.transaction();
      const startTime = new Date().getTime();
      function printTimeElasped(label: string) {
        console.log(`${label}: ${new Date().getTime() - startTime}`);
      }
      printTimeElasped('Before begin transaction');
      await transaction1.run();
      printTimeElasped('After begin transaction');
      await transaction1.get(key);
      printTimeElasped('After fetch');
      transaction1.save({key, data: obj});
      printTimeElasped('After save');
      const committedResults1 = await transaction1.commit();
      printTimeElasped('After commit');
      const [entity1] = await datastore.get(key);
      delete entity1[datastore.KEY];
      // Do a second transaction where we provide the id from the first transaction in the second transaction
      const transaction = datastore.transaction();
      const options = {
        newTransaction: {
          readWrite: {
            previousTransaction: transaction1.id,
          },
        },
      };
      printTimeElasped('Before begin transaction');
      printTimeElasped('After begin transaction');
      await transaction.get(key, options);
      printTimeElasped('After fetch');
      if (transaction1.id && transaction.returnedTransaction) {
        // Almost always not equal
        assert.notEqual(transaction1.id[3], transaction.returnedTransaction[3]);
      } else {
        throw Error('transaction properties not defined');
      }
      const committedResults = await transaction.commit();
      printTimeElasped('After commit');
      const [entity] = await datastore.get(key);
      // delete entity[datastore.KEY];
      // assert.deepStrictEqual(entity, obj);
    });

    it('should produce results when the transaction is committed', async () => {
      const key = datastore.key(['Company', 'Google']);
      const obj = {
        url: 'www.google.com',
      };
      // First do a transaction so that we have an id to provide in the next transaction
      const transaction1 = datastore.transaction();
      const startTime = new Date().getTime();
      function printTimeElasped(label: string) {
        console.log(`${label}: ${new Date().getTime() - startTime}`);
      }
      printTimeElasped('Before begin transaction');
      await transaction1.run();
      printTimeElasped('After begin transaction');
      await transaction1.get(key);
      printTimeElasped('After fetch');
      transaction1.save({key, data: obj});
      printTimeElasped('After save');
      const committedResults1 = await transaction1.commit();
      printTimeElasped('After commit');
      const [entity1] = await datastore.get(key);
      delete entity1[datastore.KEY];
      // Do a second transaction where we provide the id from the first transaction in the second transaction
      const transaction = datastore.transaction();
      const options = {
        newTransaction: {
          readWrite: {
            previousTransaction: transaction1.id,
          },
        },
      };
      printTimeElasped('Before begin transaction');
      printTimeElasped('After begin transaction');
      await transaction.get(key, options);
      printTimeElasped('After fetch');
      const committedResults = await transaction.commit();
      printTimeElasped('After commit');
      const [entity] = await datastore.get(key);
      // delete entity[datastore.KEY];
      // assert.deepStrictEqual(entity, obj);
    });

    it('should try running with a key and a local mutation', async () => {
      /*
      2c30626d18eca5fffd28214cebfe2ce4370353fe
      Before begin transaction: 0
      After begin transaction: 3102
      After fetch: 3362
      After save: 3362
      After commit: 3471
      Before begin transaction: 3572
      After begin transaction: 3572
      After fetch: 3671
      After commit: 3787
      24cc5967ecd2fe3809a33fdf81b4852893b87885
      Before begin transaction: 0
      After begin transaction: 3176
      After fetch: 3271
      After save: 3271
      After commit: 3387
      Before begin transaction: 3488
      After begin transaction: 3488
      After fetch: 3602
      After commit: 3684
      */
      const key = datastore.key(['Company', 'Google']);
      const obj = {
        url: 'www.google.com',
      };
      // First do a transaction so that we have an id to provide in the next transaction
      const transaction1 = datastore.transaction();
      const startTime = new Date().getTime();
      function printTimeElasped(label: string) {
        console.log(`${label}: ${new Date().getTime() - startTime}`);
      }
      printTimeElasped('Before begin transaction');
      await transaction1.run();
      printTimeElasped('After begin transaction');
      await transaction1.get(key);
      printTimeElasped('After fetch');
      transaction1.save({key, data: obj});
      printTimeElasped('After save');
      const committedResults1 = await transaction1.commit();
      printTimeElasped('After commit');
      const [entity1] = await datastore.get(key);
      delete entity1[datastore.KEY];
      // Do a second transaction where we provide the id from the first transaction in the second transaction
      const transaction = datastore.transaction();
      const options = {
        newTransaction: {
          readWrite: {
            previousTransaction: transaction1.id,
          },
        },
      };
      printTimeElasped('Before begin transaction');
      printTimeElasped('After begin transaction');
      const [entity] = await transaction.get(key, options);
      delete entity[datastore.KEY];
      printTimeElasped('After fetch');
      entity.url = 'www.google2.com';
      transaction.save({key, data: entity});
      printTimeElasped('After save');
      const committedResults = await transaction.commit();
      printTimeElasped('After commit');
      // const [entity] = await datastore.get(key);
      // delete entity[datastore.KEY];
      // assert.deepStrictEqual(entity, obj);
    });

    it('should run with begin transaction and also new transaction with an existing transaction', async () => {
      /*
      2c30626d18eca5fffd28214cebfe2ce4370353fe
      Before begin transaction: 0
      After begin transaction: 2966
      After fetch: 3070
      After save: 3070
      After commit: 3185
      Before begin transaction: 3272
      After begin transaction: 3377
      After fetch: 3567
      After commit: 3639
      24cc5967ecd2fe3809a33fdf81b4852893b87885
      Before begin transaction: 0
      After begin transaction: 3814
      After fetch: 3905
      After save: 3906
      After commit: 4033
      Before begin transaction: 4115
      After begin transaction: 4228
      After fetch: 4301
      After commit: 4416
      */
      const key = datastore.key(['Company', 'Google']);
      const obj = {
        url: 'www.google.com',
      };
      // First do a transaction so that we have an id to provide in the next transaction
      const transaction1 = datastore.transaction();
      const startTime = new Date().getTime();
      function printTimeElasped(label: string) {
        console.log(`${label}: ${new Date().getTime() - startTime}`);
      }
      printTimeElasped('Before begin transaction');
      await transaction1.run();
      printTimeElasped('After begin transaction');
      await transaction1.get(key);
      printTimeElasped('After fetch');
      transaction1.save({key, data: obj});
      printTimeElasped('After save');
      const committedResults1 = await transaction1.commit();
      printTimeElasped('After commit');
      const [entity1] = await datastore.get(key);
      delete entity1[datastore.KEY];
      // Do a second transaction where we provide the id from the first transaction in the second transaction
      const transaction = datastore.transaction();
      const options = {
        newTransaction: {
          readWrite: {
            previousTransaction: transaction1.id,
          },
        },
      };
      printTimeElasped('Before begin transaction');
      await transaction.run();
      printTimeElasped('After begin transaction');
      await transaction.get(key, options);
      printTimeElasped('After fetch');
      const committedResults = await transaction.commit();
      printTimeElasped('After commit');
      const [entity] = await datastore.get(key);
      // delete entity[datastore.KEY];
      // assert.deepStrictEqual(entity, obj);
    });

    it('should pass in response to previous_transaction when previous tx has not been committed', async () => {
      const key = datastore.key(['Company', 'Google']);
      const obj = {
        url: 'www.google.com',
      };
      // First do a transaction so that we have an id to provide in the next transaction
      const transaction1 = datastore.transaction();
      const startTime = new Date().getTime();
      function printTimeElasped(label: string) {
        console.log(`${label}: ${new Date().getTime() - startTime}`);
      }
      printTimeElasped('Before begin transaction');
      await transaction1.run();
      printTimeElasped('After begin transaction');
      await transaction1.get(key);
      printTimeElasped('After fetch');
      transaction1.save({key, data: obj});
      // Do a second transaction where we provide the id from the first transaction in the second transaction
      const transaction = datastore.transaction();
      const options = {
        newTransaction: {
          readWrite: {
            previousTransaction: transaction1.id,
          },
        },
      };
      printTimeElasped('Before begin transaction');
      await transaction.run();
      printTimeElasped('After begin transaction');
      await transaction.get(key, options);
      printTimeElasped('After save');
      const committedResults1 = await transaction1.commit();
      printTimeElasped('After commit');
      const [entity1] = await datastore.get(key);
      delete entity1[datastore.KEY];
      printTimeElasped('After fetch');
      const committedResults = await transaction.commit();
      printTimeElasped('After commit');
      const [entity] = await datastore.get(key);
      // delete entity[datastore.KEY];
      // assert.deepStrictEqual(entity, obj);
    });

    it.only('should save data for transaction that is run second', async () => {
      const key = datastore.key(['Company', 'Google']);
      const obj = {
        url: 'www.google.com',
      };
      const obj2 = {
        url: 'www.google.com2',
      };
      // First do a transaction so that we have an id to provide in the next transaction
      const transaction1 = datastore.transaction();
      const startTime = new Date().getTime();
      function printTimeElasped(label: string) {
        console.log(`${label}: ${new Date().getTime() - startTime}`);
      }
      printTimeElasped('Before begin transaction');
      await transaction1.run();
      printTimeElasped('After begin transaction');
      await transaction1.get(key);
      printTimeElasped('After fetch');
      transaction1.save({key, data: obj});
      // Do a second transaction where we provide the id from the first transaction in the second transaction
      const transaction = datastore.transaction();
      const options = {
        newTransaction: {
          readWrite: {
            previousTransaction: transaction1.id,
          },
        },
      };
      printTimeElasped('Before begin transaction');
      printTimeElasped('After save');
      await transaction.get(key, options);
      printTimeElasped('After begin transaction');
      transaction.save({key, data: obj2});
      printTimeElasped('After fetch');
      const committedResults = await transaction.commit();
      printTimeElasped('After commit');
      const committedResults1 = await transaction1.commit();
      printTimeElasped('After commit');
      const [entity1] = await datastore.get(key);
      assert.strictEqual(entity1.url, 'www.google.com2');
      delete entity1[datastore.KEY];
      printTimeElasped('After fetch');
      const [entity] = await datastore.get(key);
      // delete entity[datastore.KEY];
      // assert.deepStrictEqual(entity, obj);
    });

    it('should run with begin transaction and see if returned transaction matches one provided', async () => {
      const key = datastore.key(['Company', 'Google']);
      const obj = {
        url: 'www.google.com',
      };
      // First do a transaction so that we have an id to provide in the next transaction
      const id = 'sample';
      const transaction1 = datastore.transaction({id});
      const startTime = new Date().getTime();
      function printTimeElasped(label: string) {
        console.log(`${label}: ${new Date().getTime() - startTime}`);
      }
      printTimeElasped('Before begin transaction');
      await transaction1.run();
      printTimeElasped('After begin transaction');
      await transaction1.get(key);
      printTimeElasped('After fetch');
      transaction1.save({key, data: obj});
      printTimeElasped('After save');
      const committedResults1 = await transaction1.commit();
      printTimeElasped('After commit');
      const [entity1] = await datastore.get(key);
      delete entity1[datastore.KEY];
      // Do a second transaction where we provide the id from the first transaction in the second transaction
      const transaction = datastore.transaction();
      const options = {
        newTransaction: {
          readWrite: {
            previousTransaction: transaction1.id,
          },
        },
      };
      printTimeElasped('Before begin transaction');
      await transaction.run();
      printTimeElasped('After begin transaction');
      await transaction.get(key, options);
      printTimeElasped('After fetch');
      const committedResults = await transaction.commit();
      printTimeElasped('After commit');
      const [entity] = await datastore.get(key);
      // delete entity[datastore.KEY];
      // assert.deepStrictEqual(entity, obj);
    });
    async function getTransactionId(
      options?: RunQueryOptions,
      options2?: RunQueryOptions,
      urlParam?: string
    ) {
      const url = urlParam ?? 'www.google.com';
      const key = datastore.key(['Company', 'Google']);
      const obj = {
        url,
      };
      const transaction = datastore.transaction();
      await transaction.run();
      const results1 = await transaction.get(key, options);
      const results2 = await transaction.get(key, options2);
      transaction.save({key, data: obj});
      await transaction.commit();
      const [entity] = await datastore.get(key);
      delete entity[datastore.KEY];
      return transaction.id;
    }

    it('should run previous transaction in a transaction', async () => {
      const key = datastore.key(['Company', 'Google']);
      const obj = {
        url: 'test',
      };
      await datastore.save({key, data: obj});
      const startTime = new Date().getTime();
      function printTimeElasped(label: string) {
        console.log(`${label}: ${new Date().getTime() - startTime}`);
      }
      printTimeElasped('Before begin transaction');
      const transaction = datastore.transaction();
      await transaction.run();
      const options = {
        newTransaction: {
          readWrite: {
            previousTransaction: Buffer.from('734'),
          },
        },
      };
      const results = await transaction.get(key, options);
      await transaction.commit();
      printTimeElasped('After commit');
      console.log(results);
    });

    it('should run two write transactions and then read referencing the first transaction', async () => {
      const key = datastore.key(['Company', 'Google']);
      const obj = {
        url: 'www.google.com1',
      };
      // First do a transaction so that we have an id to provide in the next transaction
      const transaction1 = datastore.transaction();
      const startTime = new Date().getTime();
      function printTimeElasped(label: string) {
        console.log(`${label}: ${new Date().getTime() - startTime}`);
      }
      printTimeElasped('Before begin transaction');
      await transaction1.run();
      printTimeElasped('After begin transaction');
      await transaction1.get(key);
      printTimeElasped('After fetch');
      transaction1.save({key, data: obj});
      printTimeElasped('After save');
      const committedResults1 = await transaction1.commit();
      printTimeElasped('After commit');
      const [entity1] = await datastore.get(key);
      delete entity1[datastore.KEY];
      // Second do another write transaction
      const transaction2 = datastore.transaction();
      const obj2 = {
        url: 'www.google.com2',
      };
      printTimeElasped('Before begin transaction');
      await transaction2.run();
      printTimeElasped('After begin transaction');
      await transaction2.get(key);
      printTimeElasped('After fetch');
      transaction2.save({key, data: obj2});
      printTimeElasped('After save');
      const committedResults2 = await transaction2.commit();
      printTimeElasped('After commit');
      const [entity2] = await datastore.get(key);
      delete entity2[datastore.KEY];
      // Do a third transaction where we provide the id from the first transaction in the third transaction
      const transaction = datastore.transaction();
      const options = {
        newTransaction: {
          readWrite: {
            previousTransaction: transaction1.id,
          },
        },
      };
      printTimeElasped('Before begin transaction');
      await transaction.run();
      printTimeElasped('After begin transaction');
      await transaction.get(key, options);
      printTimeElasped('After fetch');
      const committedResults = await transaction.commit();
      printTimeElasped('After commit');
      const [entity] = await datastore.get(key);
      console.log(entity); // Will be www.google.com2
    });

    it('should run two write transactions and then reference both transactions', async () => {
      const key = datastore.key(['Company', 'Google']);
      const obj = {
        url: 'www.google.com1',
      };
      // First do a transaction so that we have an id to provide in the next transaction
      const transaction1 = datastore.transaction();
      const startTime = new Date().getTime();
      function printTimeElasped(label: string) {
        console.log(`${label}: ${new Date().getTime() - startTime}`);
      }
      printTimeElasped('Before begin transaction');
      await transaction1.run();
      printTimeElasped('After begin transaction');
      await transaction1.get(key);
      printTimeElasped('After fetch');
      transaction1.save({key, data: obj});
      printTimeElasped('After save');
      const committedResults1 = await transaction1.commit();
      printTimeElasped('After commit');
      const [entity1] = await datastore.get(key);
      delete entity1[datastore.KEY];
      // Second do another write transaction
      const transaction2 = datastore.transaction();
      const obj2 = {
        url: 'www.google.com2',
      };
      printTimeElasped('Before begin transaction');
      await transaction2.run();
      printTimeElasped('After begin transaction');
      await transaction2.get(key);
      printTimeElasped('After fetch');
      transaction2.save({key, data: obj2});
      printTimeElasped('After save');
      const committedResults2 = await transaction2.commit();
      printTimeElasped('After commit');
      const [entity2] = await datastore.get(key);
      delete entity2[datastore.KEY];
      // Do a third transaction where we provide the id from the first transaction in the third transaction
      const transaction = datastore.transaction();
      const transactionBeforeFetch1 = transaction.id;
      printTimeElasped('After begin transaction');
      const options = {
        newTransaction: {
          readWrite: {
            previousTransaction: transaction1.id,
          },
        },
      };
      await transaction.get(key, options);
      const transactionAfterFetch1 = transaction.returnedTransaction;
      printTimeElasped('After fetch');
      const options2 = {
        newTransaction: {
          readWrite: {
            previousTransaction: transaction2.returnedTransaction,
          },
        },
      };
      await transaction.get(key, options2);
      const transactionAfterFetch2 = transaction.id;
      printTimeElasped('After fetch 2');
      const committedResults = await transaction.commit();
      printTimeElasped('After commit');
      assert.strictEqual(transactionBeforeFetch1, undefined);
      assert.notEqual(transactionAfterFetch1, undefined);
      assert.strictEqual(transactionAfterFetch2, undefined);
      const [entity] = await datastore.get(key);
      console.log(entity); // Will be www.google.com2
    });

    it('should run in a transaction with second transaction', async () => {
      const id = await getTransactionId();
      if (id) {
        console.log(id.toString());
      }
      const id2 = await getTransactionId();
      if (id2) {
        console.log(id2.toString());
      }
      const options = {
        newTransaction: {
          readWrite: {
            previousTransaction: id,
          },
        },
      };
      const options2 = {
        newTransaction: {
          readWrite: {
            previousTransaction: id2,
          },
        },
      };
      await getTransactionId(options, options2);
    });

    it('should run in a transaction with second transaction and compare results', async () => {
      const id = await getTransactionId(undefined, undefined, 'url1');
      if (id) {
        console.log(id.toString());
      }
      const id2 = await getTransactionId(undefined, undefined, 'url2');
      if (id2) {
        console.log(id2.toString());
      }
      const options = {
        newTransaction: {
          readWrite: {
            previousTransaction: id,
          },
        },
      };
      await getTransactionId(options);
    });

    it('should run when previous transaction is some non-existent transaction', async () => {
      const options = {
        newTransaction: {
          readWrite: {
            previousTransaction: Buffer.from('734'), // Create some random buffer here
          },
        },
      };
      await getTransactionId(options);
    });

    /*
    it('should run in a transaction', async () => {
      const key = datastore.key(['Company', 'Google']);
      const obj = {
        url: 'www.google.com',
      };
      const transaction = datastore.transaction();
      await transaction.run();
      await transaction.get(key);
      transaction.save({key, data: obj});
      await transaction.commit();
      const [entity] = await datastore.get(key);
      delete entity[datastore.KEY];
      assert.deepStrictEqual(entity, obj);
    });
    */

    it('should run in a transaction with transaction begin', async () => {
      const key = datastore.key(['Company', 'Google']);
      const obj = {
        url: 'www.google.com',
      };
      const transaction = datastore.transaction();
      await transaction.run();
      await transaction.get(key);
      transaction.save({key, data: obj});
      await transaction.commit();
      const [entity] = await datastore.get(key);
      delete entity[datastore.KEY];
      assert.deepStrictEqual(entity, obj);
    });

    it('should commit all saves and deletes at the end', async () => {
      const deleteKey = datastore.key(['Company', 'Subway']);
      const key = datastore.key(['Company', 'Google']);
      const incompleteKey = datastore.key('Company');

      await datastore.save({
        key: deleteKey,
        data: {},
      });
      const transaction = datastore.transaction();

      await transaction.run();
      transaction.delete(deleteKey);

      transaction.save([
        {
          key,
          data: {rating: 10},
        },
        {
          key: incompleteKey,
          data: {rating: 100},
        },
      ]);

      await transaction.commit();

      // Incomplete key should have been given an ID.
      assert.strictEqual(incompleteKey.path.length, 2);

      const [[deletedEntity], [fetchedEntity]] = await Promise.all([
        // Deletes the key that is in the deletion queue.
        datastore.get(deleteKey),
        // Updates data on the key.
        datastore.get(key),
      ]);
      assert.strictEqual(typeof deletedEntity, 'undefined');
      assert.strictEqual(fetchedEntity.rating, 10);
    });

    it('should use the last modification to a key', async () => {
      const incompleteKey = datastore.key('Company');
      const key = datastore.key(['Company', 'Google']);
      const transaction = datastore.transaction();
      await transaction.run();
      transaction.save([
        {
          key,
          data: {
            rating: 10,
          },
        },
        {
          key: incompleteKey,
          data: {
            rating: 100,
          },
        },
      ]);
      transaction.delete(key);
      await transaction.commit();

      // Should not return a result.
      const [entity] = await datastore.get(key);
      assert.strictEqual(entity, undefined);

      // Incomplete key should have been given an id.
      assert.strictEqual(incompleteKey.path.length, 2);
    });

    it('should query within a transaction', async () => {
      const transaction = datastore.transaction();
      await transaction.run();
      const query = transaction.createQuery('Company');
      let entities;
      try {
        [entities] = await query.run();
      } catch (e) {
        await transaction.rollback();
        return;
      }
      assert(entities!.length > 0);
      await transaction.commit();
    });

    it('should aggregate query within a transaction', async () => {
      const transaction = datastore.transaction();
      await transaction.run();
      const query = transaction.createQuery('Company');
      const aggregateQuery = transaction
        .createAggregationQuery(query)
        .count('total');
      let result;
      try {
        [result] = await aggregateQuery.run();
      } catch (e) {
        await transaction.rollback();
        return;
      }
      assert.deepStrictEqual(result, [{total: 2}]);
      await transaction.commit();
    });

    it('should read in a readOnly transaction', async () => {
      const transaction = datastore.transaction({readOnly: true});
      const key = datastore.key(['Company', 'Google']);
      await transaction.run();
      await transaction.get(key);
    });

    it('should not write in a readOnly transaction', async () => {
      const transaction = datastore.transaction({readOnly: true});
      const key = datastore.key(['Company', 'Google']);
      await transaction.run();
      await transaction.get(key);
      transaction.save({key, data: {}});
      await assert.rejects(transaction.commit());
    });
  });

  describe('indexes', () => {
    // @TODO: Until the protos support creating indexes, these tests depend on
    // the remote state of declared indexes. Could be flaky!
    it('should get all indexes', async () => {
      const [indexes] = await datastore.getIndexes();
      assert.ok(
        indexes.length >= DECLARED_INDEXES.length,
        'has at least the number of indexes per system-test/data/index.yaml'
      );

      // Comparing index.yaml and the actual defined index in Datastore requires
      // assumptions to complete a shape transformation, so let's just see if
      // a returned index has the right shape and not inspect the values.
      const [firstIndex] = indexes;

      assert.ok(firstIndex, 'first index is readable');
      assert.ok(firstIndex.metadata!.properties, 'has properties collection');
      assert.ok(
        firstIndex.metadata!.properties.length,
        'with properties inside'
      );
      assert.ok(firstIndex.metadata!.ancestor, 'has the ancestor property');
    });

    it('should get all indexes as a stream', done => {
      const indexes: Index[] = [];

      datastore
        .getIndexesStream()
        .on('error', done)
        .on('data', index => {
          indexes.push(index);
        })
        .on('end', () => {
          assert(indexes.length >= DECLARED_INDEXES.length);
          done();
        });
    });

    it('should get a specific index', async () => {
      const [indexes] = await datastore.getIndexes();
      const [firstIndex] = indexes;

      const index = datastore.index(firstIndex.id);
      const [metadata] = await index.getMetadata();
      assert.deepStrictEqual(
        metadata,
        firstIndex.metadata,
        'asked index is the same as received index'
      );
    });
  });

  describe('importing and exporting entities', () => {
    const gcs = new Storage();
    const bucket = gcs.bucket('nodejs-datastore-system-tests');

    const delay = async (test: Mocha.Context) => {
      const retries = test.currentRetry();
      if (retries === 0) return; // no retry on the first failure.
      // see: https://cloud.google.com/storage/docs/exponential-backoff:
      const ms = Math.pow(2, retries) * 500 + Math.random() * 1000;
      return new Promise(done => {
        console.info(`retrying "${test.title}" in ${ms}ms`);
        setTimeout(done, ms);
      });
    };

    it('should export, then import entities', async function () {
      this.retries(3);
      delay(this);
      const [exportOperation] = await datastore.export({bucket});
      await exportOperation.promise();

      const [files] = await bucket.getFiles({maxResults: 1});
      const [exportedFile] = files;
      assert.ok(exportedFile.name.includes('overall_export_metadata'));

      const [importOperation] = await datastore.import({
        file: exportedFile,
      });

      // This is a >20 minute operation, so we're just going to make sure the
      // right type of operation was started.
      assert.strictEqual(
        (
          importOperation.metadata as google.datastore.admin.v1.IImportEntitiesMetadata
        ).inputUrl,
        `gs://${exportedFile.bucket.name}/${exportedFile.name}`
      );

      await importOperation.cancel();
    });
  });

  describe('using a custom endpoint', () => {
    it('should complete a request when using the default endpoint as a custom endpoint', async () => {
      const customDatastore = new Datastore({
        namespace: `${Date.now()}`,
        apiEndpoint: 'datastore.googleapis.com',
      });
      const query = customDatastore.createQuery('Kind').select('__key__');
      const [entities] = await customDatastore.runQuery(query);
      assert.strictEqual(entities.length, 0);
    });
  });
});
