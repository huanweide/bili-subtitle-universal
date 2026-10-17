'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const target = path.join(root, 'bili-subtitle.user.js');
const modules = [
  { file: 'candidate-scorer.js', init: 'var CandidateScorer = createCandidateScorerModule();' },
  { file: 'search-filter.js', init: 'var SearchFilter = createSearchFilterModule();' },
  { file: 'transcript-quality.js', init: 'var TranscriptQuality = createTranscriptQualityModule();' },
  { file: 'seg-resume.js', init: 'var SegResume = createSegResumeModule();' },
  { file: 'route-identity.js', init: 'var RouteIdentity = createRouteIdentityModule();' },
  { file: 'site-match.js', init: 'var SiteMatch = createSiteMatchModule();' },
  { file: 'sub-export.js', init: 'var SubExport = createSubExportModule();' }
];

function browserSource(file) {
  const source = fs.readFileSync(path.join(root, 'modules', file), 'utf8')
    .replace(/^'use strict';\s*/, '')
    .replace(/\n?\/\/ <node-only>[\s\S]*?\/\/ <\/node-only>\s*$/, '')
    .trim();
  return source.split('\n').map((line) => '  ' + line).join('\n');
}

const begin = '  // <build:modules>';
const end = '  // </build:modules>';
const source = fs.readFileSync(target, 'utf8');
const start = source.indexOf(begin);
const finish = source.indexOf(end);
if (start < 0 || finish < start) throw new Error('主脚本缺少 build:modules 标记');

const generated = [
  begin,
  '  // 由 build.js 生成；请编辑 modules/*.js，不要直接修改本区。',
  ...modules.flatMap((entry) => [browserSource(entry.file), '  ' + entry.init]),
  end
].join('\n');

const next = source.slice(0, start) + generated + source.slice(finish + end.length);
fs.writeFileSync(target, next, 'utf8');
console.log('已同步 ' + modules.length + ' 个模块到 bili-subtitle.user.js');
