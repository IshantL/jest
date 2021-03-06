/**
 * Copyright (c) Facebook, Inc. and its affiliates. All Rights Reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import util from 'util';
import chalk from 'chalk';
import pretty from 'pretty-format';
import {isPrimitive} from 'jest-get-type';
import {ErrorWithStack} from 'jest-util';

type Table = Array<Array<any>>;
type PrettyArgs = {
  args: Array<any>;
  title: string;
};

const EXPECTED_COLOR = chalk.green;
const RECEIVED_COLOR = chalk.red;
const SUPPORTED_PLACEHOLDERS = /%[sdifjoOp%]/g;
const PRETTY_PLACEHOLDER = '%p';
const INDEX_PLACEHOLDER = '%#';

export default (cb: Function, supportsDone: boolean = true) => (...args: any) =>
  function eachBind(title: string, test: Function, timeout?: number): void {
    if (args.length === 1) {
      const [tableArg] = args;

      if (!Array.isArray(tableArg)) {
        const error = new ErrorWithStack(
          '`.each` must be called with an Array or Tagged Template Literal.\n\n' +
            `Instead was called with: ${pretty(tableArg, {
              maxDepth: 1,
              min: true,
            })}\n`,
          eachBind,
        );
        return cb(title, () => {
          throw error;
        });
      }

      if (isTaggedTemplateLiteral(tableArg)) {
        if (isEmptyString(tableArg[0])) {
          const error = new ErrorWithStack(
            'Error: `.each` called with an empty Tagged Template Literal of table data.\n',
            eachBind,
          );
          return cb(title, () => {
            throw error;
          });
        }

        const error = new ErrorWithStack(
          'Error: `.each` called with a Tagged Template Literal with no data, remember to interpolate with ${expression} syntax.\n',
          eachBind,
        );
        return cb(title, () => {
          throw error;
        });
      }

      if (isEmptyTable(tableArg)) {
        const error = new ErrorWithStack(
          'Error: `.each` called with an empty Array of table data.\n',
          eachBind,
        );
        return cb(title, () => {
          throw error;
        });
      }
      const table: Table = tableArg.every(Array.isArray)
        ? tableArg
        : tableArg.map(entry => [entry]);
      return table.forEach((row, i) =>
        cb(
          arrayFormat(title, i, ...row),
          applyRestParams(supportsDone, row, test),
          timeout,
        ),
      );
    }

    const templateStrings = args[0];
    const data = args.slice(1);

    const keys = getHeadingKeys(templateStrings[0]);
    const table = buildTable(data, keys.length, keys);

    const missingData = data.length % keys.length;

    if (missingData > 0) {
      const error = new ErrorWithStack(
        'Not enough arguments supplied for given headings:\n' +
          EXPECTED_COLOR(keys.join(' | ')) +
          '\n\n' +
          'Received:\n' +
          RECEIVED_COLOR(pretty(data)) +
          '\n\n' +
          `Missing ${RECEIVED_COLOR(missingData.toString())} ${pluralize(
            'argument',
            missingData,
          )}`,
        eachBind,
      );

      return cb(title, () => {
        throw error;
      });
    }

    return table.forEach(row =>
      cb(
        interpolate(title, row),
        applyObjectParams(supportsDone, row, test),
        timeout,
      ),
    );
  };

const isTaggedTemplateLiteral = (array: any) => array.raw !== undefined;
const isEmptyTable = (table: Array<any>) => table.length === 0;
const isEmptyString = (str: string) =>
  typeof str === 'string' && str.trim() === '';

const getPrettyIndexes = (placeholders: RegExpMatchArray) =>
  placeholders.reduce((indexes: Array<number>, placeholder, index) => {
    if (placeholder === PRETTY_PLACEHOLDER) {
      indexes.push(index);
    }
    return indexes;
  }, []);

const arrayFormat = (title: string, rowIndex: number, ...args: Array<any>) => {
  const placeholders = title.match(SUPPORTED_PLACEHOLDERS) || [];
  const prettyIndexes = getPrettyIndexes(placeholders);

  const {title: prettyTitle, args: remainingArgs} = args.reduce(
    (acc: PrettyArgs, arg, index) => {
      if (prettyIndexes.indexOf(index) !== -1) {
        return {
          args: acc.args,
          title: acc.title.replace(
            PRETTY_PLACEHOLDER,
            pretty(arg, {maxDepth: 1, min: true}),
          ),
        };
      }

      return {
        args: acc.args.concat([arg]),
        title: acc.title,
      };
    },
    {args: [], title},
  );

  return util.format(
    prettyTitle.replace(INDEX_PLACEHOLDER, rowIndex.toString()),
    ...remainingArgs.slice(0, placeholders.length - prettyIndexes.length),
  );
};

type Done = () => {};

const applyRestParams = (
  supportsDone: boolean,
  params: Array<any>,
  test: Function,
) =>
  supportsDone && params.length < test.length
    ? (done: Done) => test(...params, done)
    : () => test(...params);

const getHeadingKeys = (headings: string): Array<string> =>
  headings.replace(/\s/g, '').split('|');

const buildTable = (
  data: Array<any>,
  rowSize: number,
  keys: Array<string>,
): Array<any> =>
  Array.from({length: data.length / rowSize})
    .map((_, index) => data.slice(index * rowSize, index * rowSize + rowSize))
    .map(row =>
      row.reduce(
        (acc, value, index) => Object.assign(acc, {[keys[index]]: value}),
        {},
      ),
    );

const getMatchingKeyPaths = (title: string) => (
  matches: Array<string>,
  key: string,
) => matches.concat(title.match(new RegExp(`\\$${key}[\\.\\w]*`, 'g')) || []);

const replaceKeyPathWithValue = (data: any) => (
  title: string,
  match: string,
) => {
  const keyPath = match.replace('$', '').split('.');
  const value = getPath(data, keyPath);

  if (isPrimitive(value)) {
    return title.replace(match, String(value));
  }
  return title.replace(match, pretty(value, {maxDepth: 1, min: true}));
};

const interpolate = (title: string, data: any) =>
  Object.keys(data)
    .reduce(getMatchingKeyPaths(title), []) // aka flatMap
    .reduce(replaceKeyPathWithValue(data), title);

const applyObjectParams = (supportsDone: boolean, obj: any, test: Function) =>
  supportsDone && test.length > 1
    ? (done: Done) => test(obj, done)
    : () => test(obj);

const pluralize = (word: string, count: number) =>
  word + (count === 1 ? '' : 's');

const getPath = (
  o: {[key: string]: any},
  [head, ...tail]: Array<string>,
): any => {
  if (!head || !o.hasOwnProperty || !o.hasOwnProperty(head)) return o;
  return getPath(o[head], tail);
};
