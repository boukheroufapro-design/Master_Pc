import { Component } from '@angular/core';
import { Node } from './node/node';

@Component({
  imports: [Node],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {}
