// Open handler to add Menu
function onOpen(e) {
  var ui = DocumentApp.getUi();
  
  if (e && e.authMode == ScriptApp.AuthMode.NONE) {
    ui.createMenu('Markdown')
      .addItem('Latex Equation', 'ConvertEquation')
      .addToUi();
  } else {
    ui.createMenu('Markdown')
      .addItem('Export File', 'ConvertToMarkdownFile')
      .addItem('Export Email', 'ConvertToMarkdownEmail')
      .addItem('Latex Equation', 'ConvertEquation')
      .addToUi();
  }
}

function onInstall(e) {
  onOpen(e);
}

function ConvertEquation() {
  var element = DocumentApp.getActiveDocument().getCursor().getElement();
  
  // Scan upwards for an equation
  while(element.getType() != DocumentApp.ElementType.EQUATION) {
    if(element.getParent() == null)
      break;
    
    element = element.getParent();  
  }
  
  if(element.getType() != DocumentApp.ElementType.EQUATION) {
    DocumentApp.getUi().alert("Put cursor into an equation element!"); 
    return; 
  }
  
  // Covert equation
  var latexEquation = handleEquationFunction(element); 
  var latexEquationText = "$" + latexEquation.trim() + "$"; 
  
  // Show results
  DocumentApp.getUi().alert(latexEquationText);
}

// Convert current document to markdown and email it 
function ConvertToMarkdownEmail() {
  // Convert to markdown
  var convertedDoc = markdown(); 
  
  // Add markdown document to attachments
  convertedDoc.attachments.push({"fileName":DocumentApp.getActiveDocument().getName()+".md", 
                                 "mimeType": "text/plain", "content": convertedDoc.text});

  // In some cases user email is not accessible  
  var mail = Session.getActiveUser().getEmail(); 
  if(mail === '') {
    DocumentApp.getUi().alert("Could not read your email address"); 
    return;
  }
  
  // Send email with markdown document
  MailApp.sendEmail(mail,
					"[MARKDOWN_MAKER] "+DocumentApp.getActiveDocument().getName(),
					"Your converted markdown document is attached (converted from "+DocumentApp.getActiveDocument().getUrl()+")"+
					"\n\nDon't know how to use the format options? See http://github.com/mangini/gdocs2md\n",
					{ "attachments": convertedDoc.attachments });
}


// Convert current document to file and save it to GDrive
function ConvertToMarkdownFile() {
  // Convert to markdwon
  var convertedDoc = markdown();
  var outputName = DocumentApp.getActiveDocument().getName() + "-exported.md";
  
  var ui = DocumentApp.getUi(); 
  var result = ui.alert(
    'This will delete files named "' + outputName + '"',
    'Are you ok with that?',
    ui.ButtonSet.YES_NO);
  
  if(result == ui.Button.YES) {
    var files = DriveApp.getFilesByName(outputName);
    while (files.hasNext()) {
      var file = files.next();
      file.setTrashed(true); 
      Logger.log(file.getName());
    }
    
    // create file in Drive root
    DriveApp.createFile(outputName, convertedDoc.text, "text/plain");
  } else {
    Logger.log("Do not delete target folder, stopping!"); 
    return; 
  }
}

function processSection(section) {
  var state = {
    'inSource' : false, // Document read pointer is within a fenced code block
    'images' : [], // Image data found in document
    'imageCounter' : 0, // Image counter 
    'prevDoc' : [], // Pointer to the previous element on aparsing tree level
    'nextDoc' : [], // Pointer to the next element on a parsing tree level
    'size' : [], // Number of elements on a parsing tree level
    'listCounters' : [], // List counter
  };
  
  // Process element tree outgoing from the root element
  var textElements = processElement(section, state, 0);
  
  return {
    'textElements' : textElements,
    'state' : state,
  }; 
}


function markdown() {
  // Text elements
  var textElements = []; 
  
  // Process header
  var head = DocumentApp.getActiveDocument().getHeader(); 
  if(head != null) {
    // Do not include empty header sections
    var teHead = processSection(head); 
    if(teHead.textElements.length > 0) {
      textElements = textElements.concat(teHead.textElements); 
      textElements.push('\n\n'); 
      textElements.push('---'); 
      textElements.push('\n\n');
    }
  }
  
  // Process body
  var doc = DocumentApp.getActiveDocument().getBody();
  doc = processSection(doc); 
  textElements = textElements.concat(doc.textElements); 
  
  // Process footer
  var foot = DocumentApp.getActiveDocument().getFooter(); 
  Logger.log("foot: " + foot);
  if(foot != null) {
    var teFoot = processSection(foot); 
    // Do not include empty footer sections
    if(teFoot.textElements.length > 0) {
      textElements.push('\n\n'); 
      textElements.push('---'); 
      textElements.push('\n\n'); 
      textElements = textElements.concat(teFoot.textElements); 
    }
  }
  
  // Build final output string
  var text = textElements.join('');
  
  // Replace critical chars
  text = text.replace('\u201d', '"').replace('\u201c', '"');
  
  // Debug logging
  Logger.log("Result: " + text);
  Logger.log("Images: " + doc.state.imageCounter);
  
  // Build attachment and file lists
  var attachments = [];
  var files = [];
  for(var i in doc.state.images) {
    var image = doc.state.images[i];
    attachments.push( {
      "fileName": image.name,
      "mimeType": image.type,
      "content": image.bytes
    } );
    
    files.push( {
      "name" : image.name,
      "blob" : image.blob
    });
  }
  
  // Results
  return {
    'files' : files,
    'attachments' : attachments,
    'text' : text,
  };
}


function escapeHTML(text) {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Add repeat function to strings
String.prototype.repeat = function( num ) {
  return new Array( num + 1 ).join( this );
}

function handleTable(element, state, depth) {
  var textElements = [];
  
  textElements.push("\n");
  
  function buildTable(size) {
    var stack = []
    var maxSize = 0; 
    
    for(var ir=0; ir<element.getNumRows(); ir++) {
      var row = element.getRow(ir);
      
      // Add header seperator
      if(ir == 1) {
        for(var ic=0; ic<row.getNumCells(); ic++) {
          stack.push("|-" + "-".repeat(size));
        }
        stack.push("-|\n");
      }
      
      // Add table data
      for(var ic=0; ic<row.getNumCells(); ic++) {
        var cell = row.getCell(ic);
        
        // Recursively build cell content
        var text = processChilds(cell, state, depth+1).join('');
        
        text = text.replace(/(\r\n|\n|\r)/gm,"");
        maxSize = Math.max(text.length, maxSize); 
        
        if(size > text.length) {
          text += " ".repeat(size - text.length)
        }
        
        stack.push("| " + text);
      }
      
      stack.push(" |\n");
    }
    
    stack.push("\n");
    return {
      maxSize : maxSize,
      stack : stack,
    };
  }
  
  var table = buildTable(100); 
  table = buildTable(Math.max(10, table.maxSize + 1)); 
  textElements = textElements.concat(table.stack);
  
  textElements.push('\n');
  return textElements;
}

function formatMd(text, indexLeft, formatLeft, indexRight, formatRight) {
  var leftPad = '' + formatLeft; 
  if(indexLeft > 0) {
    if(text[indexLeft - 1] != ' ')
      leftPad = ' ' + formatLeft; 
  }
  
  var rightPad = formatRight + '';
  if(indexRight < text.length) {
    if(text[indexRight] != ' ') {
      rightPad = formatRight + ' ';
    }
  }
  
  var formatted = text.substring(0, indexLeft) + leftPad + text.substring(indexLeft, indexRight) + rightPad + text.substring(indexRight);
  return formatted;
}


function handleText(doc, state) {
  var formatted = doc.getText(); 
  var lastIndex = formatted.length; 
  var attrs = doc.getTextAttributeIndices();
  
  // Iterate backwards through all attributes
  for(var i=attrs.length-1; i >= 0; i--) {
    // Current position in text
    var index = attrs[i];
        
    // Handle links
    if(doc.getLinkUrl(index)) {
      var url = doc.getLinkUrl(index);
      if (i > 0 && attrs[i-1] == index - 1 && doc.getLinkUrl(attrs[i-1]) === url) {
        i -= 1;
        index = attrs[i];
        url = txt.getLinkUrl(off);
      }
      formatted = formatted.substring(0, index) + '[' + formatted.substring(index, lastIndex) + '](' + url + ')' + formatted.substring(lastIndex);
      
      // Do not handle additional formattings for links
      continue; 
    } 
    
    // Handle font family
    if(doc.getFontFamily(index)) {
      var font = doc.getFontFamily(index); 
      var sourceFont = "Courier New"; 
      
      if (!state.inSource && font === sourceFont) {
        // Scan left until text without source font is found
        while (i > 0 && doc.getFontFamily(attrs[i-1]) && doc.getFontFamily(attrs[i-1]) === sourceFont) {
          i -= 1;
          off = attrs[i];
        }
        
        formatted = formatMd(formatted, index, '`', lastIndex, '`');
        
        // Do not handle additional formattings for code
        continue; 
      }
    }
    
    // Handle bold and bold italic
    if(doc.isBold(index)) {
      var dleft, right;
      dleft = dright = "**";
      if (doc.isItalic(index)) 
      {
        // edbacher: changed this to handle bold italic properly.
        dleft = "**_"; 
        dright  = "_**";
      }
      
      formatted = formatMd(formatted, index, dleft, lastIndex, dright); 
    } 
    // Handle italic
    else if(doc.isItalic(index)) {
      formatted = formatMd(formatted, index, '*', lastIndex, '*'); 
    }
    
    // Keep track of last position in text
    lastIndex = index; 
  }
  
  var textElements = [formatted]; 
  return textElements; 
}



function handleListItem(item, state, depth) {
  var textElements = [];
  
  // Prefix
  var prefix = '';
  
  // Add nesting level
  for (var i=0; i<item.getNestingLevel(); i++) {
    prefix += '  ';
  }
  
  // Add marker based on glyph type
  var glyph = item.getGlyphType();
  Logger.log("Glyph: " + glyph);
  switch(glyph) {
    case DocumentApp.GlyphType.BULLET:
    case DocumentApp.GlyphType.HOLLOW_BULLET:
    case DocumentApp.GlyphType.SQUARE_BULLET: 
      prefix += '- ';
      break;
    case DocumentApp.GlyphType.NUMBER:
      prefix += '1. ';
      break;
    default:
      prefix += '- ';
      break;
  }
  
  // Add prefix
  textElements.push(prefix);
  
  // Handle all childs
  textElements = textElements.concat(processChilds(item, state, depth));
  
  return textElements;
}

function handleImage(image, state) {
  // Determine file extension based on content type
  var contentType = image.getBlob().getContentType();
  var fileExtension = '';
  if (/\/png$/.test(contentType)) {
    fileExtension = ".png";
  } else if (/\/gif$/.test(contentType)) {
    fileExtension = ".gif";
  } else if (/\/jpe?g$/.test(contentType)) {
    fileExtension = ".jpg";
  } else {
    throw "Unsupported image type: " + contentType;
  }

  // Create filename
  var filename = 'img_' + state.imageCounter + fileExtension;
  state.imageCounter++;
  
  // Add image
  var textElements = []
  textElements.push('![image alt text](' + filename + ')');
  state.images.push( {
    "bytes": image.getBlob().getBytes(), 
    "blob": image.getBlob(), 
    "type": contentType, 
    "name": filename,
  });
  
  return textElements;
}


// Escape chars with a special meaning in Latex
function latexSanitize(text) {
  text = text.replace("\\", "\\\\"); 
  text = text.replace("%", "\\%");
  return text; 
}


// Converte an Equation or Function element to a Latex expression
function handleEquationFunction(func, state) {
  //Logger.log("Equation converter handling: " + func.getType());
  var equation =  ""; 
  
  for(var i=0; i<func.getNumChildren(); i++) {
    var child = func.getChild(i); 
    
    if(child.getType() == DocumentApp.ElementType.EQUATION_FUNCTION) {
      equation += child.getCode() + "{" + handleEquationFunction(child, state); 
    }
    else if(child.getType() == DocumentApp.ElementType.EQUATION_FUNCTION_ARGUMENT_SEPARATOR) {
      equation = equation.trim() + "}{"; 
    }
    else if(child.getType() == DocumentApp.ElementType.EQUATION_SYMBOL) {
      equation += child.getCode() + " "; 
    }
    else if(child.getType() == DocumentApp.ElementType.TEXT) {
      equation += latexSanitize(child.getText()) + " "; 
    }
  }
  
  if(func.getType() == DocumentApp.ElementType.EQUATION_FUNCTION)
    equation = equation.trim() + "}";
  
  //Logger.log("Equation converter result: " + equation);
  return equation;
}


function processChilds(doc, state, depth) {
  // Text element buffer
  var textElements = []
  
  // Keep track of child count on this depth
  state.size[depth] = doc.getNumChildren(); 
  
  // Iterates over all childs
  for(var i=0; i < doc.getNumChildren(); i++)  {
    var child = doc.getChild(i); 
    
    // Update pointer on next document
    var nextDoc = (i+1 < doc.getNumChildren())?doc.getChild(i+1) : child;
    state.nextDoc[depth] = nextDoc; 
    
    // Update pointer on prev element 
    var prevDoc = (i-1 >= 0)?doc.getChild(i-1) : child;
    state.prevDoc[depth] = prevDoc; 
    
    textElements = textElements.concat(processElement(child, state, depth+1)); 
  }
  return textElements;
}


function processElement(element, state, depth) {
  // Result
  var textElements = [];
    
  switch(element.getType()) {
    case DocumentApp.ElementType.DOCUMENT:
      Logger.log("this is a document"); 
      break; 
      
    case DocumentApp.ElementType.BODY_SECTION: 
      textElements = textElements.concat(processChilds(element, state, depth));
      break; 
      
    case DocumentApp.ElementType.PARAGRAPH:
      // Determine header prefix
      var prefix = ''; 
      switch (element.getHeading()) {
        // Add a # for each heading level. No break, so we accumulate the right number.
        case DocumentApp.ParagraphHeading.HEADING6: prefix += '#';
        case DocumentApp.ParagraphHeading.HEADING5: prefix += '#';
        case DocumentApp.ParagraphHeading.HEADING4: prefix += '#';
        case DocumentApp.ParagraphHeading.HEADING3: prefix += '#';
        case DocumentApp.ParagraphHeading.HEADING2: prefix += '#';
        case DocumentApp.ParagraphHeading.HEADING1: prefix += '#';
      }
      
      // Add space
      if(prefix.length > 0)
        prefix += ' ';
      
      // Push prefix
      textElements.push(prefix);
      
      // Process childs
      textElements = textElements.concat(processChilds(element, state, depth));
      
      // Add paragraph break only if its not the last element on this layer
      if(state.nextDoc[depth-1] == element)
        break; 
      
      if(state.inSource)
        textElements.push('\n');
      else
        textElements.push('\n\n');
      
      break; 
      
    case DocumentApp.ElementType.LIST_ITEM:
      textElements = textElements.concat(handleListItem(element, state, depth)); 
      textElements.push('\n');
      
      if(state.nextDoc[depth-1].getType() != element.getType()) {
        textElements.push('\n');
      }
      
      break;
     
    case DocumentApp.ElementType.HEADER_SECTION:
      textElements = textElements.concat(processChilds(element, state, depth));
      break; 
      
    case DocumentApp.ElementType.FOOTER_SECTION:
      textElements = textElements.concat(processChilds(element, state, depth));
      break;
      
    case DocumentApp.ElementType.FOOTNOTE:
      textElements.push(' (NOTE: ');
      textElements = textElements.concat(processChilds(element.getFootnoteContents(), state, depth));
      textElements.push(')');
      break; 
      
    case DocumentApp.ElementType.HORIZONTAL_RULE:
      textElements.push('---\n');
      break; 
     
    case DocumentApp.ElementType.INLINE_DRAWING:
      // Cannot handle this type - there is no export function for rasterized or SVG images...
      break; 
      
    case DocumentApp.ElementType.TABLE:
      textElements = textElements.concat(handleTable(element, state, depth));
      break;
      
    case DocumentApp.ElementType.TABLE_OF_CONTENTS:
      textElements.push('[[TOC]]');
      break;
      
    case DocumentApp.ElementType.TEXT:
      var text = handleText(element, state);
      
      // Check for source code delimiter
      if(/^```.+$/.test(text.join(''))) {
        state.inSource = true; 
      }
      
      if(text.join('') === '```') {
        state.inSource = false; 
      }
      
      textElements = textElements.concat(text);
      break;

    case DocumentApp.ElementType.INLINE_IMAGE: 
      textElements = textElements.concat(handleImage(element, state));
      break; 
      
    case DocumentApp.ElementType.PAGE_BREAK:
      // Ignore page breaks
      break; 
      
    case DocumentApp.ElementType.EQUATION: 
      var latexEquation = handleEquationFunction(element, state); 

      // If equation is the only one in a paragraph - center it 
      var wrap = '$'
      if(state.size[depth-1] == 1) {
        wrap = '$$'
      }
      
      latexEquation = wrap + latexEquation.trim() + wrap; 
      textElements.push(latexEquation);
      break; 
    default:
      throw("Unknown element type: " + element.getType());
  }
  
  return textElements; 
}
