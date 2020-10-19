'use strict';

const e = React.createElement;

class topNav extends React.Component {
    constructor(props) {
        super(props);
        this.state = { selected: false };
    }

    render() {
        if (this.state.liked) {
            return 'You liked this.';
        }

        return e(
            'button',
            { onClick: () => this.setState({ selected: true }) },
            'Like'
        );
    }
}

const domContainer = document.querySelector('#like_button_container');
ReactDOM.render(e(topNav), domContainer);