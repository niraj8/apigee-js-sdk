/* eslint-.env node */

const gulp = require('gulp');
const eslint = require('gulp-eslint');
const babel = require('gulp-babel');
const jsdoc = require('gulp-jsdoc3');
const del = require('del');
const jest = require('gulp-jest').default;

const OUT_DIR = 'dist';

gulp.task('lint', () => {
    return gulp.src(['src/*.js', '!node_modules/**'])
        .pipe(eslint({ fix: true }))
        .pipe(eslint.format());
});

gulp.task('babel', () => {
    return gulp.src('src/*.js')
        .pipe(babel())
        // .pipe(concat('apigee-js-sdk.js'))
        .pipe(gulp.dest(OUT_DIR));
});

gulp.task('jest', function () {
    process.env.NODE_ENV = 'test';
    return gulp.src('tests')
        .pipe(jest({
            'verbose': false,
            'collectCoverageFrom': [
                'src/*.{js,jsx}',
                '!**/node_modules/**',
                '!**/vendor/**'
            ]
        }));
});

gulp.task('doc', (callback) => {
    gulp.src(['README.md', 'src/*.js'], { read: false })
        .pipe(jsdoc(callback));
});


gulp.task('clean', () => del([`${OUT_DIR}/`]));

gulp.task('default', gulp.series('lint', 'clean', 'babel', 'jest', 'doc'));

gulp.task('test', gulp.series('clean', 'babel', 'jest'));
