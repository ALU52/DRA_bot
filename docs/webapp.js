'use strict';

const e = React.createElement;

class topNav extends React.Component {
    constructor(props) {
        super(props);
        this.state = { selected: false };
    }

    render() {
        if (this.state.selected) {
            return 'You selected this.';
        }

        return e(
            'button',
            { onClick: () => this.setState({ selected: true }) },
            'Like'
        );
    }
}

const domContainer = document.querySelector('#appDisplay');
ReactDOM.render(e(topNav), domContainer);