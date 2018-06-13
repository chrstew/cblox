// Compress client files and put them in ./cosmicblocks/client/

// render CSS
var fs = require('fs');
var sass = require('node-sass');
var compressor = require('node-minify');

console.log('Compressing css and javascript...');

sass.render({
	file    : './cosmicblocks/style.scss',
	outFile : './cosmicblocks/client/style.css',
	outputStyle: 'compressed',
}, function(error, result) {
	if(!error){
		fs.writeFile('./cosmicblocks/client/style.css', result.css, function(err){
			if(!err){
				console.log('minified style.scss successfully.');
			} else {
				console.log('Sass failure!!');
				console.log(err);
			}
		});
	} else {
		console.log('Sass failure!!');
		console.log(error);
	}
});

compressor.minify({
	compressor: 'gcc',
	input  : './cosmicblocks/client.js',
	output : './cosmicblocks/client/client.js',
	callback: function (err, min) {
		if (!err) {
			console.log('minified client.js successfully.');
		} else {
			console.log('node-minify failure!');
		}
	}
});
