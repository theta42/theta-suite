if ! ip route | grep -q "10.0.0.0/8"; then
    echo "Warning: Missing route for 10.0.0.0/8. Containers will return 502 for relayed hostnames."
fi
